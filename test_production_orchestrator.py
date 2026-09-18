import os
import tempfile
import unittest

from production_orchestrator import resume_production_workflow, run_production_workflow


class ProductionOrchestratorTests(unittest.TestCase):
    def run_in_temp_dir(self, callback):
        original_dir = os.getcwd()
        with tempfile.TemporaryDirectory() as temp_dir:
            os.chdir(temp_dir)
            try:
                return callback()
            finally:
                os.chdir(original_dir)

    def test_parallel_workers_merge_deterministically(self):
        result = self.run_in_temp_dir(
            lambda: run_production_workflow(
                topic="graph test",
                audience="founders",
                angle="reliable leverage",
                count=3,
                thread_id="test-fanout",
            )
        )

        self.assertEqual(result["status"], "released")
        self.assertEqual(len(result["candidates"]), 3)
        self.assertEqual(result["winner"], result["ranked_candidates"][0])

    def test_approval_interrupt_resumes_before_release(self):
        def exercise():
            paused = run_production_workflow(
                topic="approval test",
                audience="founders",
                angle="controlled release",
                count=2,
                require_approval=True,
                thread_id="test-approval",
            )
            self.assertIn("__interrupt__", paused)
            self.assertEqual(paused["status"], "ranked")

            resumed = resume_production_workflow("test-approval", "approve")
            self.assertEqual(resumed["status"], "released")
            self.assertEqual(resumed["release"]["status"], "prod")

        self.run_in_temp_dir(exercise)


if __name__ == "__main__":
    unittest.main()
