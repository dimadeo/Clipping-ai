import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';

const clean = (value, maximum = 700) => String(value || '').replace(/[<>]/g, '').trim().slice(0, maximum);

const CreativeState = Annotation.Root({
  brief: Annotation,
  draft: Annotation,
  artDirectorNote: Annotation,
  approval: Annotation,
  trace: Annotation({ reducer: (current, update) => [...current, ...update], default: () => [] })
});

/**
 * A human-supervised LangGraph around the existing creative prompt agent.
 * The graph deliberately stops before creation or publishing: the dashboard
 * remains the place where the owner chooses a direction and gives approval.
 */
export class LangGraphCreativeOrchestrator {
  constructor({ creativeAgent, apiKey = process.env.OPENAI_API_KEY, model = process.env.CREATIVE_MODEL || 'gpt-5-mini' } = {}) {
    if (!creativeAgent) throw new Error('A CreativePromptAgent is required');
    this.creativeAgent = creativeAgent;
    this.modelName = model;
    this.model = apiKey ? new ChatOpenAI({ apiKey, model, temperature: 0.8 }) : null;
    this.graph = new StateGraph(CreativeState)
      .addNode('understand_brief', async (state) => ({
        brief: { ...state.brief, subject: clean(state.brief?.subject, 9000) },
        trace: [{ node: 'understand_brief', status: 'complete', at: new Date().toISOString() }]
      }))
      .addNode('create_directions', async (state) => ({
        draft: this.creativeAgent.create(state.brief),
        trace: [{ node: 'create_directions', status: 'complete', at: new Date().toISOString() }]
      }))
      .addNode('art_director_review', async (state) => ({
        artDirectorNote: await this.review(state),
        trace: [{ node: 'art_director_review', status: this.model ? 'model-reviewed' : 'rule-reviewed', at: new Date().toISOString() }]
      }))
      .addNode('await_owner_approval', async () => ({
        approval: { required: true, status: 'awaiting_owner_approval', message: 'Choose one direction in the Creative Studio before sending it to the creation executor.' },
        trace: [{ node: 'await_owner_approval', status: 'waiting', at: new Date().toISOString() }]
      }))
      .addEdge(START, 'understand_brief')
      .addEdge('understand_brief', 'create_directions')
      .addEdge('create_directions', 'art_director_review')
      .addEdge('art_director_review', 'await_owner_approval')
      .addEdge('await_owner_approval', END)
      .compile();
  }

  async review(state) {
    if (!this.model) {
      return 'Three directions are ready. Review composition, material realism, colour discipline, and how the work will live in a customer’s home before approving one.';
    }
    const directions = state.draft.candidates.map((candidate) => `${candidate.label}: ${candidate.creativeRationale}`).join('\n');
    const response = await this.model.invoke([
      ['system', 'You are the art director for The Dark Matters. Give a concise, practical review for a luxury digital-art collection. Never approve publishing or creation; a human owner decides.'],
      ['human', `Brief: ${JSON.stringify(state.draft.brief)}\nDirections:\n${directions}\nGive one short review note.`]
    ]);
    return clean(typeof response.content === 'string' ? response.content : JSON.stringify(response.content));
  }

  async run(brief) {
    const state = await this.graph.invoke({ brief, trace: [] }, {
      runName: 'dark-matters-creative-approval',
      tags: ['dark-matters', 'creative-studio', 'human-approval']
    });
    return {
      ...state.draft,
      orchestration: {
        provider: this.model ? 'LangChain + LangGraph' : 'LangGraph (local review mode)',
        model: this.model ? this.modelName : null,
        artDirectorNote: state.artDirectorNote,
        approval: state.approval,
        trace: state.trace
      }
    };
  }
}
