export const enum tag {
  dice = 1,
  constant,
  add,
  subtract,
  multiply,
  floordivide,
  ceildivide,
  negate,
  boolean_not,
  coerce_bool,
  less,
  lessequal,
  greater,
  greaterequal,
  equal,
  notequal,
  conditional,
  min,
  max,
}

type unary = tag.negate | tag.boolean_not | tag.coerce_bool

type binary_arithmetic = tag.add | tag.subtract | tag.multiply | tag.floordivide | tag.ceildivide
type relational = tag.less | tag.lessequal | tag.greater | tag.greaterequal | tag.equal | tag.notequal
type binary = binary_arithmetic | relational

type variadic = tag.min | tag.max

type dice_expression_node = { tag: tag.dice, amount: number, sides: number } & ({ keep: null } | { keep: number, keep_low: boolean })

export type expression_node = (
    dice_expression_node |
    { tag: tag.constant, amount: number } |
    { tag: binary, left: expression_node, right: expression_node } |
    { tag: unary, operand: expression_node } |
    { tag: tag.conditional, condition: expression_node, if_true: expression_node, if_false: expression_node } |
    { tag: variadic, args: expression_node[] }
)
