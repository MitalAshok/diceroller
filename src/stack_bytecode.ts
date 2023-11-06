import { expression_node, tag } from './expression_nodes'

// Synchronise this with evaluate.cpp
export const enum bytecode_value {
  no_arg_start = 1,
  op_add = no_arg_start,
  op_subtract,
  op_multiply,
  op_floordivide,
  op_ceildivide,
  op_negate,
  op_lt,
  op_le,
  op_gt,
  op_ge,
  op_eq,
  op_ne,
  op_min2,
  op_min3,
  op_max2,
  op_max3,
  op_conditional,
  op_coerce_bool,
  op_boolean_not,
  no_arg_end = op_boolean_not,

  one_arg_start = no_arg_end + 1,
  op_push_constant = one_arg_start,
  one_arg_end = op_push_constant,

  two_arg_start = one_arg_end + 1,
  op_roll_simple = two_arg_start,
  two_arg_end = op_roll_simple,

  three_arg_start = two_arg_end + 1,
  op_roll_kl = three_arg_start,
  op_roll_kh,
  three_arg_end = op_roll_kh,
}

const nan_encoding = { tag: tag.floordivide, right: { tag: tag.constant, amount: 0 }, left: { tag: tag.constant, amount: 0 } } as const

export const bytecode_precalculate_length = (e : expression_node) : number => {
  switch (e.tag) {
    case tag.constant:
      // NaN rewritten to 0/0
      if (Number.isNaN(e.amount)) return bytecode_precalculate_length(nan_encoding)
      return 5
    case tag.dice: return e.keep === null ? 1+2*4 : 1+3*4
    case tag.add: case tag.subtract: case tag.multiply: case tag.floordivide: case tag.ceildivide:
    case tag.less: case tag.lessequal: case tag.greater: case tag.greaterequal:
    case tag.equal: case tag.notequal:
      return 1 + bytecode_precalculate_length(e.left) + bytecode_precalculate_length(e.right)
    case tag.negate: case tag.boolean_not: case tag.coerce_bool:
      return 1 + bytecode_precalculate_length(e.operand)
    case tag.conditional:
      return 1 + bytecode_precalculate_length(e.condition) + bytecode_precalculate_length(e.if_true) + bytecode_precalculate_length(e.if_false)
    case tag.min:
    case tag.max:
      const { args } = e
      if (args.length === 0) {
        // Rewritten to NaN
        return bytecode_precalculate_length({ tag: tag.constant, amount: NaN })
      }
      // Written as "push all args to the stack then min3 min3 ..." until there are 1 or 2 args on the stack. If 2 left, then one more min2
      // number_of_min3 * 2 + number_of_min2 == args.length - 1
      const number_of_min2 = 1 - (args.length % 2)
      const number_of_min3 = (args.length - 1 - number_of_min2) / 2
      return args.reduce((acc, arg) => acc + bytecode_precalculate_length(arg), number_of_min3 + number_of_min2)
  }
}

const to_int32be = (n : number, output : (byte : number) => void) : void => {
  if (!Number.isFinite(n)) throw RangeError('Invalid number: ' + n)
  if ((n % 1) !== 0) throw RangeError('Invalid number (not an integer): ' + n)
  if (!(-0x80000000 <= n && n <= 0x7FFFFFFF)) throw RangeError('Number out of range: ' + n)

  output((n >>> 24) & 0xFF)
  output((n >>> 16) & 0xFF)
  output((n >>> 8) & 0xFF)
  output((n >>> 0) & 0xFF)
}

// Calls output with each byte of the stackcode. Returns maximum size of stack
export const to_bytecode = (e : expression_node, output : (byte : number) => void) : number => {
  switch (e.tag) {
    case tag.constant: {
      const { amount } = e
      if (Number.isNaN(amount)) return to_bytecode(nan_encoding, output)
      output(bytecode_value.op_push_constant)
      to_int32be(amount, output)
      return 1
    }
    case tag.dice: {
      const { amount, sides, keep } = e
      output(keep === null ? bytecode_value.op_roll_simple : e.keep_low ? bytecode_value.op_roll_kl : bytecode_value.op_roll_kh)
      to_int32be(amount, output)
      to_int32be(sides, output)
      if (keep === null) return 1
      to_int32be(keep, output)
      return keep+1  // TODO: decide between two strategies
      // 1: takes AMOUNT space: generate all dice rolls, find the highest/lowest N and add them (AMOUNT log KEEP time)
      // 2: takes KEEP space: generate KEEP dice, heapify, push+pop (AMOUNT-KEEP) times (KEEP + (AMOUNT-KEEP) log KEEP == AMOUNT log KEEP time)
    }
    case tag.add: case tag.subtract: case tag.multiply: case tag.floordivide: case tag.ceildivide:
    case tag.less: case tag.lessequal: case tag.greater: case tag.greaterequal:
    case tag.equal: case tag.notequal: {
      const { left, right } = e
      const left_stack = to_bytecode(left, output)
      const right_stack = 1 + to_bytecode(right, output)
      // On the stack: left, right
      // Action: right = pop(); left = pop(); push(command(left, right))
      switch (e.tag) {
        case tag.add: output(bytecode_value.op_add); break
        case tag.subtract: output(bytecode_value.op_subtract); break
        case tag.multiply: output(bytecode_value.op_multiply); break
        case tag.floordivide: output(bytecode_value.op_floordivide); break
        case tag.ceildivide: output(bytecode_value.op_ceildivide); break
        case tag.less: output(bytecode_value.op_lt); break
        case tag.lessequal: output(bytecode_value.op_le); break
        case tag.greater: output(bytecode_value.op_gt); break
        case tag.greaterequal: output(bytecode_value.op_ge); break
        case tag.equal: output(bytecode_value.op_eq); break
        case tag.notequal: output(bytecode_value.op_ne); break
      }
      return Math.max(left_stack + right_stack)
    }
    case tag.negate: case tag.boolean_not: case tag.coerce_bool: {
      const { operand } = e
      const stack = to_bytecode(operand, output)
      switch (e.tag) {
        case tag.negate: output(bytecode_value.op_negate); break
        case tag.boolean_not: output(bytecode_value.op_boolean_not); break
        case tag.coerce_bool: output(bytecode_value.op_coerce_bool); break
      }
      return stack
    }
    case tag.conditional: {
      const { condition, if_true, if_false } = e
      const condition_stack = to_bytecode(condition, output)
      const if_true_stack = 1 + to_bytecode(if_true, output)
      const if_false_stack = 2 + to_bytecode(if_false, output)
      // On stack: condition, if_true, if_false
      // Action: condition = pop(); if_false = pop(); if (condition) { /* everything is fine */ } else { pop(); push(if_false) }
      output(bytecode_value.op_conditional)
      return Math.max(if_true_stack + if_false_stack + condition_stack)
    }
    case tag.min: case tag.max: {
      const { args } = e
      if (args.length === 0) return to_bytecode(nan_encoding, output)
      const three_tag = e.tag === tag.min ? bytecode_value.op_min3 : bytecode_value.op_max3
      let max_stack_size = 0
      let current_stack_size = 0
      for (const arg of args) {
        max_stack_size = Math.max(max_stack_size, current_stack_size + to_bytecode(arg, output))
        if (++current_stack_size === 3) {
          output(three_tag)
          current_stack_size = 1
        }
      }
      if (current_stack_size === 2) output(e.tag === tag.min ? bytecode_value.op_min2 : bytecode_value.op_max2)
      return max_stack_size
    }
  }
}

const read_integer_arg = (fn : () => number | null) : number | string => {
  const a = fn()
  const b = fn()
  const c = fn()
  const d = fn()
  if (a === null) return '<unfinished argument>'
  if (b === null) return '0x' + (a & 0xFF).toString(16) + ' <unfinished argument>'
  if (c === null) return '0x' + (a & 0xFF).toString(16) + (b & 0xFF).toString(16) + ' <unfinished argument>'
  if (d === null) return '0x' + (a & 0xFF).toString(16) + (b & 0xFF).toString(16) + (c & 0xFF).toString(16) + ' <unfinished argument>'

  return ((a & 0xFF) << 24) | ((b & 0xFF) << 16) | ((c & 0xFF) << 8) | (d & 0xFF)
}

const stringof_stackbytecode_impl = (fn : () => number | null) : string | null => {
  const next_byte = fn()
  if (next_byte === null) return null
  switch (next_byte as bytecode_value) {
    case bytecode_value.op_add: return 'op_add'
    case bytecode_value.op_subtract: return 'op_subtract'
    case bytecode_value.op_multiply: return 'op_multiply'
    case bytecode_value.op_floordivide: return 'op_floordivide'
    case bytecode_value.op_ceildivide: return 'op_ceildivide'
    case bytecode_value.op_negate: return 'op_negate'
    case bytecode_value.op_lt: return 'op_lt'
    case bytecode_value.op_le: return 'op_le'
    case bytecode_value.op_gt: return 'op_gt'
    case bytecode_value.op_ge: return 'op_ge'
    case bytecode_value.op_eq: return 'op_eq'
    case bytecode_value.op_ne: return 'op_ne'
    case bytecode_value.op_min2: return 'op_min2'
    case bytecode_value.op_min3: return 'op_min3'
    case bytecode_value.op_max2: return 'op_max2'
    case bytecode_value.op_max3: return 'op_max3'
    case bytecode_value.op_conditional: return 'op_conditional'
    case bytecode_value.op_coerce_bool: return 'op_coerce_bool'
    case bytecode_value.op_boolean_not: return 'op_boolean_not'

    case bytecode_value.op_push_constant: return 'op_push_constant(' + read_integer_arg(fn) + ')'

    case bytecode_value.op_roll_simple: return 'op_roll_simple(amount = ' + read_integer_arg(fn) + ', sides = ' + read_integer_arg(fn) + ')'

    case bytecode_value.op_roll_kl: return 'op_roll_kl(amount = ' + read_integer_arg(fn) + ', sides = ' + read_integer_arg(fn) + ', keep = ' + read_integer_arg(fn) + ')'
    case bytecode_value.op_roll_kh: return 'op_roll_kh(amount = ' + read_integer_arg(fn) + ', sides = ' + read_integer_arg(fn) + ', keep = ' + read_integer_arg(fn) + ')'

    default: return '<Unknown byte 0x' + next_byte.toString(16) + '>'
  }
}

export const stringof_stackbytecode = (bytes : Iterable<number>) : string => {
  const result = [] as string[]
  const gen = bytes[Symbol.iterator]()
  while (true) {
    const next = stringof_stackbytecode_impl(() => {
      const result= gen.next()
      return result.done ? null : result.value
    })
    if (next === null) break
    result.push(next)
  }

  return result.join(' ')
}
