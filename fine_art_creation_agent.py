import argparse
import hashlib
import json
import random
import re
import time
import uuid
from typing import Any, Dict

from midjourney import MidjourneyClient


CREATION_SIZE_FAMILIES = {"a_series", "square_1_1"}
CREATION_A_SERIES_SIZES = {"A4", "A3", "A2", "A1", "A0", "2A0"}
CREATION_SQUARE_SIZES_CM = {30, 50, 80, 100, 120, 150}
CREATION_ORIENTATIONS = {"portrait", "landscape", "vertical"}


def _normalize_ratio(value: str) -> str:
    ratio = str(value or "4:5").strip()
    if not re.fullmatch(r"\d{1,2}:\d{1,2}", ratio):
        raise ValueError("ratio must use W:H format, for example 4:5 or 9:16")
    return ratio


def _normalize_percentage(value, field: str, *, default: int) -> int:
    raw = default if value is None else value
    try:
        parsed = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be an integer between 0 and 100") from exc
    if parsed < 0 or parsed > 100:
        raise ValueError(f"{field} must be between 0 and 100")
    return parsed


def _normalize_creation_size_family(value: str) -> str:
    raw = str(value or "a_series").strip().lower().replace("-", "_")
    aliases = {
        "a": "a_series",
        "a_series": "a_series",
        "aseries": "a_series",
        "square": "square_1_1",
        "1:1": "square_1_1",
        "1_1": "square_1_1",
        "square_1_1": "square_1_1",
    }
    normalized = aliases.get(raw, raw)
    if normalized not in CREATION_SIZE_FAMILIES:
        raise ValueError("creation_size_family must be a_series or square_1_1")
    return normalized


def _normalize_creation_a_series_size(value: str) -> str:
    raw = str(value or "A1").strip().upper()
    if raw not in CREATION_A_SERIES_SIZES:
        raise ValueError("creation_a_series_size must be one of A4, A3, A2, A1, A0, 2A0")
    return raw


def _normalize_creation_square_size_cm(value) -> int:
    raw = 100 if value is None else value
    try:
        parsed = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("creation_square_size_cm must be one of 30, 50, 80, 100, 120, 150") from exc
    if parsed not in CREATION_SQUARE_SIZES_CM:
        raise ValueError("creation_square_size_cm must be one of 30, 50, 80, 100, 120, 150")
    return parsed


def _normalize_creation_orientations(value) -> list[str]:
    if value is None:
        items = ["portrait"]
    elif isinstance(value, str):
        items = [item.strip().lower() for item in value.split(",") if item.strip()]
    elif isinstance(value, list):
        items = [str(item).strip().lower() for item in value if str(item).strip()]
    else:
        raise ValueError("creation_orientations must be a comma-separated string or an array")

    normalized: list[str] = []
    for item in items:
        if item in CREATION_ORIENTATIONS and item not in normalized:
            normalized.append(item)
    if not normalized:
        normalized = ["portrait"]
    return normalized


def _seeded_rng(subject: str, ratio: str, intended_environment: str) -> random.Random:
    seed_material = "|".join(
        (
            subject,
            ratio,
            intended_environment,
            str(time.time_ns()),
            uuid.uuid4().hex,
        )
    )
    digest = hashlib.sha256(seed_material.encode("utf-8")).digest()
    seed = int.from_bytes(digest[:8], byteorder="big", signed=False)
    return random.Random(seed)


def _pick(rng: random.Random, values: list[str]) -> str:
    return values[rng.randrange(0, len(values))]


def _create_candidate(rng: random.Random, subject: str) -> Dict[str, str]:
    domains = [
        "material science",
        "meteorology",
        "cartography",
        "ritual studies",
        "neuropsychology",
        "acoustics",
        "microbiology",
        "industrial engineering",
        "geology",
        "ancient navigation",
        "textile architecture",
        "optics",
    ]
    core_concepts = [
        "memory can solidify into matter when pressure and light agree on a shared geometry",
        "silence can be measured as a physical load that bends engineered materials",
        "rituals can leave structural residue that behaves like weather",
        "identity can be mapped as topography rather than portraiture",
        "time can be seen as layered maintenance rather than decay",
        "desire can crystallize into architecture that never reaches completion",
    ]
    subject_universes = [
        "a decommissioned observatory converted into a laboratory for emotional weather",
        "a tidal archive where ceremonial instruments are buried inside translucent sediment",
        "an urban vault whose walls are grown from conductive mineral fabric",
        "a suspended inland sea framed by engineered scaffold monuments",
        "a vaulted chamber of cartographic relics cast in responsive ceramic",
        "an abandoned measurement hall where acoustic traces are treated as artifacts",
    ]
    composition_genomes = [
        "edge-dominant composition with a compressed lower-left density and a vast upper-right void",
        "controlled imbalance built on diagonal gravitational flow with interrupted radial echoes",
        "fragmented panorama with nested geometries and distributed micro focal points",
        "vertical monumentality broken by a thin horizontal silence band near the lower third",
        "non-Euclidean spatial choreography with overlapping depth planes and delayed visual exits",
    ]
    perspective_dna = [
        "elevated near-human viewpoint with mild wide-lens distortion and disciplined parallax",
        "low oblique perspective that magnifies mass while flattening distant depth",
        "mid-height orthographic drift where scale transitions are intentionally ambiguous",
        "compressed telephoto perception that stacks planes into a tense visual corridor",
    ]
    geometries = [
        "fractured cellular lattices fused with asymmetric buttress forms",
        "spiral fault lines intersecting modular architectural ribs",
        "fluid mineral folds constrained by mathematical truss skeletons",
        "monumental arc segments punctured by microscopic perforation fields",
        "impossible offset vaults with recursive negative cut-outs",
    ]
    materials = [
        "calcified velvet composite with conductive glass fibers",
        "pressure-aged ceramic alloy threaded with translucent basalt veins",
        "oxidized mirror-bronze grown over porous volcanic resin",
        "charred limestone foam laminated with thin iridescent mica sheets",
        "fused salt crystal mesh over hand-scored anodized steel",
    ]
    surfaces = [
        "matte scarred planes interrupted by wet reflective seams",
        "powdery mineral bloom over polished fracture edges",
        "fibrous abrasion zones blending into glass-smooth pressure points",
        "subtle pitting, heat warping, and edge oxidation with selective gloss",
        "porous chalky crust over dense metallic underlayers",
    ]
    light_physics = [
        "multi-source glancing light with cool lateral spill and a warm internal rebound",
        "hard directional beam entering from outside frame with volumetric particulate scattering",
        "soft overcast field broken by one impossible internal luminescent fissure",
        "low-angle spectral light causing selective diffraction on only one material family",
        "near-dark ambient field with precise specular activation on stressed edges",
    ]
    color_genetics = [
        "dominant desaturated umber and storm-teal field with strict copper accents",
        "cold limestone grays with narrow sulfur yellow vectors and restrained crimson traces",
        "chalk white, oxidized cyan, and smoked bronze in descending saturation hierarchy",
        "carbon black and misted silver base with rare electric olive punctures",
        "dusted clay neutrals anchored by deep viridian compression zones",
    ]
    atmosphere_systems = [
        "dry particulate haze that thickens near load-bearing intersections",
        "humid refractive air pockets that subtly bend distant edges",
        "fine mineral dust suspended in layered thermal currents",
        "nearly vacuum-like clarity disrupted by localized vapor eruptions",
        "slow metallic mist with directional drift that reveals light geometry",
    ]
    scale_relationships = [
        "human-adjacent foreground marks against cathedral-scale structural masses",
        "microscopic textural evidence embedded in a monumental architectural scene",
        "intimate surface scars contrasted with horizon-wide engineered voids",
        "object scale intentionally unstable between artifact and landscape",
    ]
    temporal_states = [
        "simultaneous excavation and construction in one frozen instant",
        "post-event stillness minutes after an unseen mechanical ritual",
        "century-long weathering compressed into a single present frame",
        "future archaeology where maintenance traces outnumber original surfaces",
    ]
    emotional_contradictions = [
        "reverence plus structural threat",
        "intimacy plus civic scale",
        "precision plus mourning",
        "certainty plus exile",
        "discipline plus longing",
    ]
    narrative_mysteries = [
        "tool marks imply a missing operator and an interrupted procedure",
        "a sealed channel suggests movement that cannot be physically traced",
        "residual heat maps indicate an event outside visible chronology",
        "careful repairs reveal prior damage from an unknown source",
    ]
    anomalies = [
        "one suspended seam of light obeys no visible source yet casts coherent shadows",
        "a narrow mineral ribbon bends perspective lines without distorting surrounding matter",
        "a reflective fracture returns an alternate depth map of the same scene",
        "an isolated surface zone behaves optically like liquid while remaining fully rigid",
    ]
    imperfections = [
        "micro abrasions, stitch-like repairs, and uneven edge settling",
        "small casting flaws, dust inclusions, and nonuniform oxidation",
        "hand-ground asymmetry and slight panel misalignment",
        "hairline cracks, chipped corners, and pressure bruising",
    ]
    negative_space = [
        "the largest void occupies the visual exit corridor and controls pacing",
        "negative space forms a second implied structure around the main mass",
        "emptiness is concentrated at top-right to counter lower-left density",
        "a central silence gap separates competing material clusters",
    ]
    optical_behaviors = [
        "selective refraction appears only at stress boundaries",
        "specular highlights drift chromatically across rough and smooth zones",
        "occlusion edges exhibit soft diffraction halos",
        "reflections reveal hidden depth vectors not present in direct view",
    ]
    rhythms = [
        "eye entry at lower-left scar cluster, spiral climb, then long pause in upper void",
        "zigzag progression between high-density anchors followed by a silent horizon release",
        "radial pulse from central seam into peripheral micro-detail fields",
        "slow vertical ascent interrupted by diagonal optical counterbeats",
    ]
    signatures = [
        "signature language of pressure memory marks repeating at non-periodic intervals",
        "signature of engineered erosion where every break edge aligns to an invisible grid",
        "signature motif of mirrored stress topologies across unrelated materials",
        "signature cadence of bright micro-faults embedded in otherwise muted planes",
    ]

    sampled_domains = rng.sample(domains, k=3)
    return {
        "core_concept": _pick(rng, core_concepts),
        "subject_universe": _pick(rng, subject_universes),
        "composition_genome": _pick(rng, composition_genomes),
        "perspective_dna": _pick(rng, perspective_dna),
        "geometry": _pick(rng, geometries),
        "material_language": _pick(rng, materials),
        "surface_behavior": _pick(rng, surfaces),
        "light_physics": _pick(rng, light_physics),
        "color_genetics": _pick(rng, color_genetics),
        "atmosphere_system": _pick(rng, atmosphere_systems),
        "scale_relationship": _pick(rng, scale_relationships),
        "temporal_state": _pick(rng, temporal_states),
        "emotional_contradiction": _pick(rng, emotional_contradictions),
        "narrative_mystery": _pick(rng, narrative_mysteries),
        "signature_anomaly": _pick(rng, anomalies),
        "imperfection_dna": _pick(rng, imperfections),
        "negative_space_logic": _pick(rng, negative_space),
        "optical_behavior": _pick(rng, optical_behaviors),
        "visual_rhythm": _pick(rng, rhythms),
        "artistic_signature": _pick(rng, signatures),
        "domain_collision": ", ".join(sampled_domains),
        "subject": subject,
    }


def _candidate_score(candidate: Dict[str, str], rng: random.Random) -> float:
    concept_density = len(candidate["core_concept"].split()) / 12.0
    complexity = len(candidate["composition_genome"].split()) / 12.0
    material_novelty = len(candidate["material_language"].split()) / 10.0
    randomness = rng.uniform(0.15, 0.45)
    raw = 8.55 + min(1.35, concept_density * 0.15 + complexity * 0.12 + material_novelty * 0.1 + randomness)
    return min(9.95, round(raw, 2))


def _mutate_candidate(candidate: Dict[str, str], rng: random.Random) -> Dict[str, str]:
    mutated = dict(candidate)
    mutation_axis = _pick(rng, ["signature_anomaly", "material_language", "optical_behavior", "negative_space_logic"])
    mutation_map = {
        "signature_anomaly": [
            "a floating fracture line projects shadows from a future sun angle",
            "one contour emits a muted afterimage that does not align with camera perspective",
            "a thin translucent plate records multiple time states in a single reflection",
        ],
        "material_language": [
            "ferrous porcelain aggregate with braided quartz capillaries",
            "compressed ash polymer shell over hand-cut mica lattice",
            "salt-glass ceramic hybrid with magnetized dust channels",
        ],
        "optical_behavior": [
            "subtle diffraction bands appear only where repaired seams cross",
            "reflection intensity increases toward rougher surfaces instead of polished ones",
            "shadow edges split into two coherence layers near load joints",
        ],
        "negative_space_logic": [
            "a vertical void column bisects the scene and acts as the true focal anchor",
            "emptiness pools beneath the primary mass to imply suspended weight",
            "negative space is fragmented into three quiet chambers that pace eye movement",
        ],
    }
    mutated[mutation_axis] = _pick(rng, mutation_map[mutation_axis])
    return mutated


def _build_title(candidate: Dict[str, str], rng: random.Random) -> str:
    first = _pick(rng, ["Load Bearing Silence", "Afterimage Meridian", "The Repair Weather", "Pressure Cartography", "Mineral Interval", "Residual Observatory"])
    second = _pick(rng, ["Protocol", "Ledger", "Index", "Chamber", "Reliquary", "Atlas"])
    return f"{first}: {second}"


def _build_core_concept(candidate: Dict[str, str], intended_environment: str) -> str:
    return (
        f"This artwork treats {candidate['subject']} as a structural event instead of an illustration, where {candidate['core_concept']}. "
        f"Its world is {candidate['subject_universe']}, shaped by principles from {candidate['domain_collision']} rather than decorative style. "
        f"The piece is composed for {intended_environment}, balancing {candidate['emotional_contradiction']} while preserving unresolved evidence that {candidate['narrative_mystery']}."
    )


def _build_master_prompt(
    title: str,
    core_concept: str,
    candidate: Dict[str, str],
    ratio: str,
    intended_environment: str,
    prompt_creator_command: str,
    art_dna_controls: Dict[str, Any],
    creation_format: Dict[str, Any],
) -> str:
    format_label = (
        creation_format["a_series_size"]
        if creation_format["size_family"] == "a_series"
        else f"1:1 {creation_format['square_size_cm']}cm"
    )
    orientation_profile = ", ".join(creation_format["orientations"])
    directive_layer = (
        "Follow the provided Fine Art Prompt Creator command as a hard art-direction brief for originality, non-repetition, material invention, and anti-cliche restraint. "
        if prompt_creator_command
        else ""
    )
    return (
        directive_layer
        +
        f"Create a museum-grade digital fine artwork titled '{title}'. "
        f"Core concept: {core_concept} "
        f"Subject universe: {candidate['subject_universe']}. "
        f"Composition genome: {candidate['composition_genome']}. "
        f"Perspective DNA: {candidate['perspective_dna']}. "
        f"Geometry: {candidate['geometry']}. "
        f"Foreground should reveal high-density material evidence and tactile imperfections; middle ground must host the primary structural mass; background should carry atmospheric depth and unresolved narrative traces. "
        f"Scale relationship: {candidate['scale_relationship']}. Temporal state: {candidate['temporal_state']}. "
        f"Material language: {candidate['material_language']}. Surface behavior: {candidate['surface_behavior']}. "
        f"Microtexture requirements: layered abrasion, nonuniform edges, and physically plausible manufacturing or weathering traces. "
        f"Light physics: {candidate['light_physics']}. Shadow behavior must preserve coherent geometry while emphasizing the signature anomaly. "
        f"Color genetics: {candidate['color_genetics']}. Atmosphere system: {candidate['atmosphere_system']}. "
        f"Negative space logic: {candidate['negative_space_logic']}. Optical behavior: {candidate['optical_behavior']}. Visual rhythm: {candidate['visual_rhythm']}. "
        f"Emotional contradiction: {candidate['emotional_contradiction']}. Signature anomaly: {candidate['signature_anomaly']}. "
        f"Creative dial profile: freedom {art_dna_controls['creative_freedom']}/100, originality {art_dna_controls['originality_priority']}/100, similarity tolerance {art_dna_controls['similarity_tolerance']}/100, commercial cliche tolerance {art_dna_controls['commercial_cliche_tolerance']}/100, predictability tolerance {art_dna_controls['predictability_tolerance']}/100, artistic ambition {art_dna_controls['artistic_ambition']}/100. "
        f"Artistic signature: {candidate['artistic_signature']}. "
        f"Execution should feel authored, concept-first, and materially credible at icon, world, and close-inspection distances. "
        f"Use format ratio {ratio}. Intended environment: {intended_environment}. Output format target: {format_label} with orientation preference {orientation_profile}. "
        "Restraint rules: avoid ornamental excess, avoid irrelevant objects, and preserve one dominant conceptual gesture. "
        "Must not include generic fantasy haze, neon spectacle, centered hero object, decorative pseudo-symbols, random floating debris, repeated portal imagery, or any artist-style imitation."
    )


def _build_negative_directive() -> str:
    exclusions = [
        "no artist-style imitation or 'in the style of' references",
        "no generic luxury interior aesthetics",
        "no centered hero object composition by default",
        "no random neon glow, portal motifs, galaxies, or decorative particles",
        "no over-symmetric layout unless conceptually required",
        "no empty complexity without narrative logic",
        "no repeated stock surreal tropes",
    ]
    return "; ".join(exclusions)


def _build_fingerprint(candidate: Dict[str, str], ratio: str, intended_environment: str) -> str:
    return (
        f"subject={candidate['subject']} | ratio={ratio} | environment={intended_environment} | "
        f"geometry={candidate['geometry']} | material={candidate['material_language']} | "
        f"light={candidate['light_physics']} | color={candidate['color_genetics']} | "
        f"anomaly={candidate['signature_anomaly']} | rhythm={candidate['visual_rhythm']}"
    )


def generate_artwork(
    subject: str,
    ratio: str,
    intended_environment: str,
    render: bool,
    prompt_creator_command: str,
    creation_prompt_override: str,
    art_dna_mode: str,
    creative_freedom: int,
    originality_priority: int,
    similarity_tolerance: int,
    commercial_cliche_tolerance: int,
    predictability_tolerance: int,
    artistic_ambition: int,
    creation_size_family: str,
    creation_a_series_size: str,
    creation_square_size_cm: int,
    creation_orientations: list[str],
) -> Dict[str, Any]:
    rng = _seeded_rng(subject, ratio, intended_environment)

    art_dna_controls = {
        "mode": art_dna_mode,
        "creative_freedom": creative_freedom,
        "originality_priority": originality_priority,
        "similarity_tolerance": similarity_tolerance,
        "commercial_cliche_tolerance": commercial_cliche_tolerance,
        "predictability_tolerance": predictability_tolerance,
        "artistic_ambition": artistic_ambition,
    }
    creation_format = {
        "size_family": creation_size_family,
        "a_series_size": creation_a_series_size,
        "square_size_cm": creation_square_size_cm,
        "orientations": creation_orientations,
    }

    candidates = []
    for _ in range(6):
        candidate = _create_candidate(rng, subject)
        score = _candidate_score(candidate, rng)
        candidates.append((score, candidate))

    best_score, best_candidate = max(candidates, key=lambda item: item[0])
    mutated = _mutate_candidate(best_candidate, rng)
    final_score = max(best_score, _candidate_score(mutated, rng))

    title = _build_title(mutated, rng)
    core_concept = _build_core_concept(mutated, intended_environment)
    generated_master_prompt = _build_master_prompt(
        title,
        core_concept,
        mutated,
        ratio,
        intended_environment,
        prompt_creator_command,
        art_dna_controls,
        creation_format,
    )
    master_prompt = str(creation_prompt_override or "").strip() or generated_master_prompt
    negative_directive = _build_negative_directive()
    fingerprint = _build_fingerprint(mutated, ratio, intended_environment)

    creation = {
        "title": title,
        "prompt": master_prompt,
        "hook": core_concept.split(".")[0].strip(),
        "visual": mutated["signature_anomaly"],
        "core_concept": core_concept,
        "negative_directive": negative_directive,
        "art_dna_fingerprint": fingerprint,
        "subject": subject,
        "ratio": ratio,
        "intended_environment": intended_environment,
        "prompt_creator_command": prompt_creator_command,
        "creation_prompt_override": creation_prompt_override,
        "art_dna": art_dna_controls,
        "format_preferences": creation_format,
    }

    result: Dict[str, Any] = {
        "status": "completed",
        "workflow": "fine_art_creation",
        "subject": subject,
        "ratio": ratio,
        "intended_environment": intended_environment,
        "prompt_creator_command": prompt_creator_command,
        "creation_prompt_override": creation_prompt_override,
        "art_dna_mode": art_dna_mode,
        "art_dna_controls": art_dna_controls,
        "creation_format": creation_format,
        "artwork_title": title,
        "core_concept": core_concept,
        "master_image_prompt": master_prompt,
        "negative_directive": negative_directive,
        "art_dna_fingerprint": fingerprint,
        "creation": creation,
        "winner": {
            "title": title,
            "prompt": master_prompt,
            "score": round(final_score, 2),
        },
        "best_prompt": master_prompt,
        "format": "art_dna_v1",
        "artwork_text": (
            "ARTWORK TITLE\n"
            f"{title}\n\n"
            "CORE CONCEPT\n"
            f"{core_concept}\n\n"
            "MASTER IMAGE PROMPT\n"
            f"{master_prompt}\n\n"
            "NEGATIVE / EXCLUSION DIRECTIVE\n"
            f"{negative_directive}\n\n"
            "ART DNA FINGERPRINT\n"
            f"{fingerprint}"
        ),
    }

    if render:
        try:
            render_job = MidjourneyClient().generate(prompt=master_prompt, aspect_ratio=ratio)
            result["render_job"] = render_job
            creation["render_job"] = render_job
        except Exception as exc:
            result["status"] = "failed"
            result["errors"] = [str(exc)]
            result["render_error"] = {"type": type(exc).__name__, "message": str(exc)}

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Fine Art Creation agent with Art DNA generation.")
    parser.add_argument("--subject", required=True, help="Starting subject or idea.")
    parser.add_argument("--ratio", default="4:5", help="Output ratio in W:H format.")
    parser.add_argument(
        "--intended-environment",
        default="gallery print",
        help="Intended display environment (for example gallery print or museum-scale print).",
    )
    parser.add_argument(
        "--prompt-creator-command",
        default="",
        help="Fine Art Prompt Creator command block from the dashboard.",
    )
    parser.add_argument(
        "--creation-prompt-override",
        default="",
        help="Approved complete prompt delivery pasted into Fine Art Creator control input.",
    )
    parser.add_argument("--art-dna-mode", default="AUTO", help="Art DNA mode label, for example AUTO.")
    parser.add_argument("--creative-freedom", type=int, default=100, help="Creative freedom from 0 to 100.")
    parser.add_argument("--originality-priority", type=int, default=100, help="Originality priority from 0 to 100.")
    parser.add_argument("--similarity-tolerance", type=int, default=1, help="Similarity tolerance from 0 to 100.")
    parser.add_argument(
        "--commercial-cliche-tolerance",
        type=int,
        default=0,
        help="Commercial cliche tolerance from 0 to 100.",
    )
    parser.add_argument(
        "--predictability-tolerance",
        type=int,
        default=0,
        help="Predictability tolerance from 0 to 100.",
    )
    parser.add_argument("--artistic-ambition", type=int, default=100, help="Artistic ambition from 0 to 100.")
    parser.add_argument(
        "--creation-size-family",
        default="a_series",
        help="Creation size family: a_series or square_1_1.",
    )
    parser.add_argument("--creation-a-series-size", default="A1", help="A-series format target: A4, A3, A2, A1, A0, or 2A0.")
    parser.add_argument(
        "--creation-square-size-cm",
        type=int,
        default=100,
        help="Square 1:1 target size in cm: 30, 50, 80, 100, 120, or 150.",
    )
    parser.add_argument(
        "--creation-orientations",
        default="portrait",
        help="Comma-separated preferred orientations: portrait, landscape, vertical.",
    )
    parser.add_argument("--render", action="store_true", help="Submit the generated prompt to the configured renderer.")
    args = parser.parse_args()

    subject = str(args.subject or "").strip()
    if not subject:
        raise ValueError("subject is required")

    ratio = _normalize_ratio(args.ratio)
    intended_environment = str(args.intended_environment or "gallery print").strip() or "gallery print"
    prompt_creator_command = str(args.prompt_creator_command or "").strip()
    creation_prompt_override = str(args.creation_prompt_override or "").strip()
    art_dna_mode = str(args.art_dna_mode or "AUTO").strip().upper() or "AUTO"
    creative_freedom = _normalize_percentage(args.creative_freedom, "creative_freedom", default=100)
    originality_priority = _normalize_percentage(args.originality_priority, "originality_priority", default=100)
    similarity_tolerance = _normalize_percentage(args.similarity_tolerance, "similarity_tolerance", default=1)
    commercial_cliche_tolerance = _normalize_percentage(
        args.commercial_cliche_tolerance,
        "commercial_cliche_tolerance",
        default=0,
    )
    predictability_tolerance = _normalize_percentage(
        args.predictability_tolerance,
        "predictability_tolerance",
        default=0,
    )
    artistic_ambition = _normalize_percentage(args.artistic_ambition, "artistic_ambition", default=100)
    creation_size_family = _normalize_creation_size_family(args.creation_size_family)
    creation_a_series_size = _normalize_creation_a_series_size(args.creation_a_series_size)
    creation_square_size_cm = _normalize_creation_square_size_cm(args.creation_square_size_cm)
    creation_orientations = _normalize_creation_orientations(args.creation_orientations)
    result = generate_artwork(
        subject=subject,
        ratio=ratio,
        intended_environment=intended_environment,
        render=bool(args.render),
        prompt_creator_command=prompt_creator_command,
        creation_prompt_override=creation_prompt_override,
        art_dna_mode=art_dna_mode,
        creative_freedom=creative_freedom,
        originality_priority=originality_priority,
        similarity_tolerance=similarity_tolerance,
        commercial_cliche_tolerance=commercial_cliche_tolerance,
        predictability_tolerance=predictability_tolerance,
        artistic_ambition=artistic_ambition,
        creation_size_family=creation_size_family,
        creation_a_series_size=creation_a_series_size,
        creation_square_size_cm=creation_square_size_cm,
        creation_orientations=creation_orientations,
    )
    print(json.dumps(result, indent=2, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
