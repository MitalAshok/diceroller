# diceroller

## Dice syntax

 * Constants: A sequence of digits (no whitespace).
 * Dice: `(N)dS` to roll the sum of `N` `S`-sided dice. Optionally followed by `(kl|kh|dl|dh)X` to keep or drop the lowest or highest `X` dice from the sum.
 * Operations: `+` to add, `-` to subtract, `*` to multiply, `/` to floor divide, `\` to ceiling divide.
 * Comparisons: `>`, `<`, `>=`, `<=`, `=`, `!=` evaluate to `1` or `0` depending on if the condition holds true.
 * Conditional: `A?B:C` will have the value of `B` if `A` is non-zero, `C` otherwise.
 * Functions: `min(A,B,C)`, `max(A,B,C)` will have the value of the minimum or maximum of all of the operands given.

Note: If you end up with an undefined value (currently only by dividing by zero or calling min/max with no arguments), all further operations will be be undefined, except conditional branches where the discarded branch would have the undefined value.  
Throwing 0 dice, keeping 0 dice or dropping all dice results in 0.

## Functions

`lexer.js`:
 * `const enum tokentag`: Tag to differentiate tokens
 * `type tokentype`: An array where the first element is a `tokentag` and the rest depend on the type of the token.
   * `tokentype.number`: Second element is the number
   * `tokentype.lparen`/`tokentype.rparen`: Second element is the type of the paren
 * `const enum parentype`: To differentiate parentheses types 
 * `default : (str : string) => tokentype[]`: Tokenise the given string into an array of tokens
 * `stringof_token : (token : tokentype) => string`: Returns a string that would tokenise into that token

`expression_nodes.js` (Only has types):
 * `const enum tag`: Tag to differentiate nodes
 * `type expression_node`: An object with different properties depending on which tag the `tag` property is set to.

`parser.js`:
 * `default : (tokens : tokentype[]) => expression_node`: Parse an array of tokens into a tree

`expression_node_transform.js`:
 * `stringof_expression_node : (node : expression_node) => string`: Return a string that would lex then parse into the same tree
 * `peephole_optimize : (node : expression_node) => expression_node`: Returns a copy of the tree where some constructs might be optimised (like constant folding)
 * `create_roll_function : (random : () => number = Math.random) => (sides : number)`: Takes a function with the same signature as `Math.random` (the default) which returns a number in [0, 1) and returns a "roll function", which takes a number of sides `n` and maps [0, 1) to the integers [1, n].
 * `roll_once : (node : expression_node, roll_function : (sides : number) => number = create_roll_function(Math.random)) => number`: Evaluates the tree using `roll_function` to get the value of a dice roll.

`stack_bytecode.js`:
 * `const enum bytecode_value`: The value of opcodes
 * `bytecode_precalculate_length : (e : expression_node) => number`: Gives the length of the bytecode gotten from flattening the tree
 * `to_bytecode : (e : expression_node, output : (byte : number) => void) => number`: Calls `output(op)` a number of times equal to `bytecode_precalculate_length(e)` with a number from 0 to 255 for each byte of the bytecode. Returns the amount of stack space needed to evaluate the stackcode.
 * `stringof_stackbytecode : (bytes : Iterable<number>) => string`: Converts an array of bytes into a human readable string

`evaluate.cpp`:
 * Imports:
   * `memory`: Memory (Specified in linker flags, `--import-memory`)
   * `void log(int64_t n)`: Called to log an integer.
   * `void log_string(const char* s)`: Called to log a null-terminated string.
 * Exports:
   * `void seed_engine(random_type seed)`: Seeds the PRNG
   * `void evaluate(const unsigned char* bytecode, uint32_t bytecode_size, int64_t* stack, uint32_t amount)`:
     Given the bytecode of an expression (as pointer + length), and a stack pointer pointing to an array of at least `amount*stack_size` `int64_t` objects, evaluate the stackcode `amount` times in parallel.

