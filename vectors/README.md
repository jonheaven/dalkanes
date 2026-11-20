# Test vectors

Every vector here comes from the reference indexer's unit tests, or from the vectors in the original draft. None was made up for this repo. Each one names its source in a `source` field. Byte strings were computed from those test values with the LEB128 and push rules in spec §5.

| File | Covers |
| --- | --- |
| [wire.json](wire.json) | Magic bytes, cellpack encoding, `OP_RETURN` scripts, calldata layout |
| [host-abi/](host-abi/) | Small WAT contracts with the outputs the reference runtime is tested to produce |

The schema is in [../schemas/vectors.schema.json](../schemas/vectors.schema.json).

A conforming implementation MUST:

1. decode every `script_hex` to the listed `cellpack`, and encode the `cellpack` back to the listed bytes;
2. running each `host-abi` case with the listed parameters, produce the listed `ok` and `return_hex`, or the listed decoded fields.

Negative vectors, such as malformed varints, bad versions and missing targets, are wanted. Please contribute ones that come from a real implementation's tests.
