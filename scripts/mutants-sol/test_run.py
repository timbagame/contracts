import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("run", Path(__file__).with_name("run.py"))
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)


class Ranges(unittest.TestCase):
    def test_parse_groups_ranges_by_file(self):
        self.assertEqual(
            run.parse_ranges("evm/src/A.sol:3-9,evm/src/B.sol:1-1,evm/src/A.sol:20-22"),
            {"evm/src/A.sol": [(3, 9), (20, 22)], "evm/src/B.sol": [(1, 1)]},
        )

    def test_parse_rejects_what_is_not_a_range(self):
        for text in ("evm/src/A.sol", "evm/src/A.sol:3", "evm/src/A.sol:a-b"):
            with self.assertRaises(ValueError):
                run.parse_ranges(text)

    def test_empty_means_no_ranges(self):
        self.assertEqual(run.parse_ranges(""), {})

    def test_a_line_is_in_when_it_is_inside_a_range_of_its_own_file(self):
        ranges = run.parse_ranges("evm/src/A.sol:3-9,evm/src/A.sol:20-22")
        self.assertFalse(run.in_ranges(ranges, "evm/src/A.sol", 2))
        self.assertTrue(run.in_ranges(ranges, "evm/src/A.sol", 3))
        self.assertTrue(run.in_ranges(ranges, "evm/src/A.sol", 9))
        self.assertFalse(run.in_ranges(ranges, "evm/src/A.sol", 10))
        self.assertTrue(run.in_ranges(ranges, "evm/src/A.sol", 22))
        self.assertFalse(run.in_ranges(ranges, "evm/src/B.sol", 5))


class Rows(unittest.TestCase):
    def test_a_change_is_described_in_a_few_words(self):
        self.assertEqual(run.describe(">", ">="), "> -> >=")
        self.assertEqual(run.describe("a  +\n  b", "a - b"), "a + b -> a - b")
        self.assertEqual(run.describe("emit Done();", ""), "remove emit Done();")

    def test_a_long_change_is_cut(self):
        text = run.describe("x" * 100, "y")
        self.assertEqual(len(text), run.MAX_CHANGE)
        self.assertTrue(text.endswith("..."))

    def test_row_is_file_line_status_change(self):
        self.assertEqual(
            run.row("evm/src/A.sol", 57, "lived", ">", ">="),
            "evm/src/A.sol:57  lived: > -> >=",
        )

    def test_summarize_lists_what_lived_by_file_and_line(self):
        rows, tally = run.summarize(
            [
                ("evm/src/B.sol", 4, "lived", "+", "-"),
                ("evm/src/A.sol", 30, "killed", "==", "!="),
                ("evm/src/A.sol", 12, "lived", "<", "<="),
                ("evm/src/A.sol", 9, "timeout", "x()", ""),
                ("evm/src/A.sol", 12, "lived", "<", "<="),
            ]
        )
        self.assertEqual(
            rows,
            [
                "evm/src/A.sol:9  timeout: remove x()",
                "evm/src/A.sol:12  lived: < -> <=",
                "evm/src/B.sol:4  lived: + -> -",
            ],
        )
        self.assertEqual(tally, "1 of 4")

    def test_nothing_to_mutate_is_zero_of_zero(self):
        self.assertEqual(run.summarize([]), ([], "0 of 0"))

    def test_results_are_written_for_the_comment_script(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "nested" / "out"
            run.write_results(out, ["evm/src/A.sol:1  lived: + -> -"], "2 of 3")
            self.assertEqual((out / "lived.txt").read_text(), "evm/src/A.sol:1  lived: + -> -\n")
            self.assertEqual((out / "tally.txt").read_text(), "2 of 3\n")
            run.write_results(out, [], "1 of 1")
            self.assertEqual((out / "lived.txt").read_text(), "")


class Mutation:
    def __init__(self, path, line, location, value, result=None):
        self.relative_path = path
        self.line_number = line - 1  # vertigo-rs counts lines from 0
        self.location = location  # a list in vertigo-rs, so not hashable
        self.value = value
        self.original_value = "<"
        self.result = result


class Result:
    KILLED, LIVED, TIMEDOUT, ERROR, EQUIVALENT = range(5)


class Filter(unittest.TestCase):
    def test_keeps_one_copy_of_each_change_on_a_requested_line(self):
        ranges = run.parse_ranges("evm/src/A.sol:10-12")
        mutations = [
            Mutation("src/A.sol", 9, [1, 1, 0], "<="),
            Mutation("src/A.sol", 10, [2, 1, 0], "<="),
            Mutation("src/A.sol", 10, [2, 1, 0], "<="),
            Mutation("src/A.sol", 10, [2, 1, 0], ">="),
            Mutation("src/A.sol", 12, [3, 1, 0], "<="),
            Mutation("src/A.sol", 13, [4, 1, 0], "<="),
            Mutation("src/B.sol", 11, [5, 1, 0], "<="),
        ]
        kept = run.range_filter(object, ranges, "evm/").apply(mutations)
        self.assertEqual(kept, [mutations[1], mutations[3], mutations[4]])


class Collect(unittest.TestCase):
    def test_only_changes_with_a_verdict_count(self):
        mutations = [
            Mutation("src/A.sol", 5, [1, 1, 0], "<=", Result.LIVED),
            Mutation("src/A.sol", 6, [2, 1, 0], "<=", Result.KILLED),
            Mutation("src/A.sol", 7, [3, 1, 0], "<=", Result.TIMEDOUT),
            Mutation("src/A.sol", 8, [4, 1, 0], "<=", Result.ERROR),
            Mutation("src/A.sol", 9, [5, 1, 0], "<=", Result.EQUIVALENT),
            Mutation("src/A.sol", 10, [6, 1, 0], "<="),
        ]
        results, skipped = run.collect(mutations, "evm", Result)
        self.assertEqual(
            results,
            [
                ("evm/src/A.sol", 5, "lived", "<", "<="),
                ("evm/src/A.sol", 6, "killed", "<", "<="),
                ("evm/src/A.sol", 7, "timeout", "<", "<="),
            ],
        )
        self.assertEqual(skipped, 3)


if __name__ == "__main__":
    unittest.main()
