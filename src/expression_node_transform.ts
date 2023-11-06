import { expression_node, tag } from './expression_nodes'

const stringof_priority = (t : tag) : number => {
  switch (t) {
    case tag.min: case tag.max: case tag.dice: case tag.constant:
      return 0
    case tag.negate: case tag.boolean_not: case tag.coerce_bool:
      return -1
    case tag.multiply: case tag.floordivide: case tag.ceildivide:
      return -2
    case tag.add: case tag.subtract:
      return -3
    case tag.less: case tag.lessequal: case tag.greater: case tag.greaterequal: case tag.equal: case tag.notequal:
      return -4
    case tag.conditional:
      return -5
  }
}

const conditional_parenthesise = (str : string, do_parenthesise : boolean) : string => do_parenthesise ? ['(', ')'].join(str) : str

export const stringof_expression_node = (node : expression_node) : string => {
  const this_priority = stringof_priority(node.tag)
  switch (node.tag) {
    case tag.dice:
      const { amount, sides, keep } = node
      return amount + 'd' + sides + (keep === null ? '' : (node.keep_low ? 'kl' : 'kh') + keep)
    case tag.constant:
      return '' + node.amount
    case tag.multiply: case tag.floordivide: case tag.ceildivide: case tag.add: case tag.subtract: case tag.less: case tag.lessequal: case tag.greater: case tag.greaterequal: case tag.equal: case tag.notequal:
      const { left, right } = node
      let op : string
      switch (node.tag) {
        case tag.multiply: op = '*'; break
        case tag.floordivide: op = '/'; break
        case tag.ceildivide: op = '\\'; break
        case tag.add: op = '+'; break
        case tag.subtract: op = '-'; break
        case tag.less: op = '<'; break
        case tag.lessequal: op = '<='; break
        case tag.greater: op = '>'; break
        case tag.greaterequal: op = '>='; break
        case tag.equal: op = '='; break
        case tag.notequal: op = '!='; break
      }
      return conditional_parenthesise(stringof_expression_node(left), stringof_priority(left.tag) < this_priority) + ' ' + op + ' ' + conditional_parenthesise(stringof_expression_node(right), stringof_priority(right.tag) <= this_priority)
    case tag.negate: case tag.boolean_not: {
      const { operand } = node
      let op : string
      switch (node.tag) {
        case tag.negate: op = '-'
        case tag.boolean_not: op = '!'
      }
      return op + conditional_parenthesise(stringof_expression_node(operand), stringof_priority(operand.tag) <= this_priority)
    }
    case tag.coerce_bool: {
      // Not actually exposed directly, is a result of simplifying !!x
      const { operand } = node
      return '!!' + conditional_parenthesise(stringof_expression_node(operand), stringof_priority(operand.tag) <= this_priority)
    }
    case tag.conditional:
      const { condition, if_true, if_false } = node
      return conditional_parenthesise(stringof_expression_node(condition), stringof_priority(condition.tag) <= this_priority) + ' ? ' + stringof_expression_node(if_true) + ' : ' + stringof_expression_node(if_false)
    case tag.min:
    case tag.max:
      let function_name : string
      switch (node.tag) {
        case tag.min: function_name = 'min'; break
        case tag.max: function_name = 'max'; break
      }
      return function_name + '(' + node.args.map(stringof_expression_node).join(', ') + ')'
  }
}

type dice_expression = Extract<expression_node, { tag: tag.dice }>
const add_dice_order = (left : dice_expression, right : dice_expression) => {
  if (left.sides < right.sides) return true
  if (left.sides > right.sides) return false
  if (left.keep == null) return right.keep === null
  return true
}

type tagged_expression_node = expression_node & { range?: ({ low: number, high: number, is_nanable: boolean } | undefined) }
const noop = (node : expression_node, range: { low: number, high: number, is_nanable: boolean } | undefined = undefined) : tagged_expression_node => {
  (node as tagged_expression_node).range = range
  return node as tagged_expression_node
}

const make_constant = (amount : number) : tagged_expression_node => noop({
    tag: tag.constant, amount
}, { low: amount, high: amount, is_nanable: Number.isNaN(amount) })

const initial_peephole_optimise = (node : tagged_expression_node) : tagged_expression_node => {
  if ('range' in node) return node
  switch (node.tag) {
    case tag.constant: return make_constant(node.amount)
    case tag.dice:
      const { amount, sides, keep } = node
      if (amount === 0 || sides === 0 || keep === 0) return make_constant(0)
      if (amount < 0) {
        if (keep === null || keep === -amount) return noop({ tag: tag.dice, amount, sides, keep: null }, { low: amount * sides, high: -amount, is_nanable: false })
        return noop({ tag: tag.dice, amount, sides, keep, keep_low: node.keep_low }, { low: -keep * sides, high: -keep, is_nanable: false })
      }
      if (keep === null || keep === amount) return noop({ tag: tag.dice, amount, sides, keep: null }, { low: amount, high: amount * sides, is_nanable: false })
      return noop({ tag: tag.dice, amount, sides, keep, keep_low: node.keep_low }, { low: keep, high: keep * sides, is_nanable: false })
    case tag.add: {
      let left = initial_peephole_optimise(node.left)
      let right = initial_peephole_optimise(node.right)
      while (right.tag === tag.add) {
        // Standardise A + (B + C) into (A + B) + C
        left = initial_peephole_optimise({ tag: tag.add, left, right: right.left })
        right = right.right
      }
      // Standardise A + c1 + B + c2 + C + c3 => A + B + C + c1 + c2 + c3 (so the constants can be combined)
      if (left.tag === tag.constant) {
        // (c1 + A) => A + c1
        if (right.tag === tag.constant) return make_constant(left.amount + right.amount)
        const temp = left
        left = right
        right = temp
      } else if (left.tag === tag.add && left.right.tag === tag.constant) {
        if (right.tag === tag.constant) return initial_peephole_optimise({ tag: tag.add, left: left.left, right: make_constant(left.right.amount + right.amount) })
        // (A + c1) + B => (A + B) + c1
        const temp = left.right
        left = initial_peephole_optimise({ tag: tag.add, left: left.left, right })
        right = temp
      } else if (right.tag !== tag.constant && (left.tag === tag.dice || (left.tag === tag.add && left.right.tag === tag.dice))) {
        // Standardise dice to be next to each other
        const leftmost = left.tag === tag.dice ? null : left.left
        let dice = left.tag === tag.dice ? left : left.right as expression_node & { tag: tag.dice }
        if (right.tag === tag.dice) {
          if (dice.keep === null && right.sides === dice.sides && right.keep === null) {
            // Combine e.g. 2d6 + 3d6 => 5d6
            const combined_dice = initial_peephole_optimise({ tag: tag.dice, amount: dice.amount + right.amount, sides: dice.sides, keep: null })
            if (leftmost === null) return combined_dice
            return initial_peephole_optimise({ tag: tag.add, left: leftmost, right: combined_dice })
          }
          if (!add_dice_order(dice, right)) {
            const temp = dice
            dice = right
            right = temp
          }
        } else {
          const temp = dice
          dice = right as any
          right = temp
        }

        if (leftmost === null) left = dice
        else left = { tag: tag.add, left: leftmost, right: dice }
      }
      if (right.tag === tag.constant) {
        let { amount } = right
        while (left.tag === tag.add && left.right.tag === tag.constant) {
          // (A + c1) + c2 => A + (c1+c2)
          amount += left.right.amount
          left = left.left
        }
        right = make_constant(amount)
        if (Number.isNaN(amount)) return make_constant(NaN)
        if (amount === 0) return left
      }
      if (left.range !== undefined && right.range !== undefined) return noop({ tag: tag.add, left, right }, { high: left.range.high + right.range.high, low: left.range.low + right.range.low, is_nanable: left.range.is_nanable || right.range.is_nanable })
      return noop({ tag: tag.add, left, right })
    }
    case tag.subtract:
      return initial_peephole_optimise({ tag: tag.add, left: node.left, right: { tag: tag.negate, operand: node.right } })
    case tag.multiply: {
      let left = initial_peephole_optimise(node.left)
      let right = initial_peephole_optimise(node.right)
      while (right.tag === tag.multiply) {
        // Standardise A * (B * C) into (A * B) * C
        left = initial_peephole_optimise({ tag: tag.multiply, left, right: right.left })
        right = right.right
      }
      // Standardise A * c1 * B * c2 * C * c3 => A * B * C * c1 * c2 * c3 (so the constants can be combined)
      if (left.tag === tag.constant) {
        // (c1 * A) => A * c1
        if (right.tag === tag.constant) return make_constant(left.amount * right.amount)
        const temp = left
        left = right
        right = temp
      } else if (left.tag === tag.multiply && left.right.tag === tag.constant) {
        if (right.tag === tag.constant) return initial_peephole_optimise({ tag: tag.multiply, left: left.left, right: make_constant(left.right.amount * right.amount) })
        // (A * c1) * B => (A * B) * c1
        const temp = left.right
        left = initial_peephole_optimise({ tag: tag.multiply, left: left.left, right })
        right = temp
      }
      if (right.tag === tag.constant) {
        let { amount } = right
        while (left.tag === tag.multiply && left.right.tag === tag.constant) {
            // (A * c1) * c2 => A * (c1*c2)
            amount *= left.right.amount
            left = left.left
        }
        right = make_constant(amount)
        if (Number.isNaN(amount)) return make_constant(NaN)
        if (amount === 0 && left.range !== undefined && !left.range.is_nanable) return make_constant(0)
        // A * 1 => A
        if (amount === 1) return left
        // A * -1 => -A
        if (amount === -1) return initial_peephole_optimise({ tag: tag.negate, operand: left })
        // (A + c1) * c2 => A*c2 + c1*c2
        if (left.tag === tag.add && left.right.tag === tag.constant)
          return initial_peephole_optimise({ tag: tag.add, left: { tag: tag.multiply, left: left.left, right: make_constant(amount) }, right: make_constant(amount * left.right.amount) })
      }
      if (left.range !== undefined && right.range !== undefined) {
        const { low: a, high: b, is_nanable: left_is_nanable } = left.range
        const { low: c, high: d, is_nanable: right_is_nanable } = right.range
        return noop({ tag: tag.multiply, left, right }, { low: Math.min(a*c, a*d, b*c, b*d), high: Math.max(a*c, a*d, b*c, b*d), is_nanable: left_is_nanable || right_is_nanable })
      }
      return noop({ tag: tag.multiply, left, right })
    }
    case tag.floordivide:
    case tag.ceildivide: {
      const left = initial_peephole_optimise(node.left)
      const right = initial_peephole_optimise(node.right)
      const fn = node.tag === tag.floordivide ? Math.floor : Math.ceil
      if (left.tag === tag.constant) {
        if (right.tag === tag.constant) {
          return make_constant(fn(left.amount / right.amount))
        }
        if (Number.isNaN(left.amount)) return make_constant(NaN)
        // if (left.amount === 0) return make_constant(0)  // TODO: check if right is NaN or 0
      } else if (right.tag === tag.constant) {
        if (Number.isNaN(right.amount) || right.amount === 0) return make_constant(NaN)
        if (right.amount === 1) return left
        if (right.amount === -1) return initial_peephole_optimise({ tag: tag.negate, operand: left })
      }
      if (left.range !== undefined && right.range !== undefined) {
        let { low: a, high: b, is_nanable: left_is_nanable } = left.range
        let { low: c, high: d, is_nanable: right_is_nanable } = right.range
        const is_nanable = left_is_nanable || right_is_nanable || ((c <= 0) && (d >= 0))
        if (c === 0) c = 1
        if (d === 0) d = -1
        return noop({ tag: tag.multiply, left, right }, { low: fn(Math.min(a/c, a/d, b/c, b/d)), high: fn(Math.max(a/c, a/d, b/c, b/d)), is_nanable })
      }
      return noop({ tag: tag.ceildivide, left: initial_peephole_optimise(node.left), right: initial_peephole_optimise(node.right) })
    }
    case tag.less:
    case tag.lessequal:
    case tag.greater:
    case tag.greaterequal:
    case tag.equal:
    case tag.notequal: {
      let left = initial_peephole_optimise(node.left)
      let right = initial_peephole_optimise(node.right)
      let node_tag = node.tag
      if (right.tag === tag.constant && Number.isNaN(right.amount)) return make_constant(NaN)
      if (left.tag === tag.constant && Number.isNaN(left.amount)) return make_constant(NaN)
      // c1 < E => E > c1
      // c1 > E => E < c1
      // etc.
      // c1 = E => E = c1
      // c1 != E => E != c1
      if (left.tag === tag.constant && right.tag !== tag.constant) {
        switch (node_tag) {
          case tag.less: node_tag = tag.greater; break
          case tag.greater: node_tag = tag.less; break
          case tag.lessequal: node_tag = tag.greaterequal; break
          case tag.greaterequal: node_tag = tag.lessequal; break
          case tag.equal:
          case tag.notequal: break
        }
        const temp = left
        left = right
        right = temp
      }
      if (right.tag === tag.constant) {
        const y = right.amount
        if (left.tag === tag.constant) {
          const x = left.amount
          switch (node_tag) {
            case tag.less: return make_constant(+(x < y))
            case tag.lessequal: return make_constant(+(x <= y))
            case tag.greater: return make_constant(+(x > y))
            case tag.greaterequal: return make_constant(+(x >= y))
            case tag.equal: return make_constant(+(x === y))
            case tag.notequal: return make_constant(+(x !== y))
          }
        } else if (y === 0) {
          // E = 0 => !E
          if (node_tag === tag.equal) return initial_peephole_optimise({ tag: tag.negate, operand: left })
          // E != 0 => !!E
          if (node_tag === tag.notequal) return initial_peephole_optimise({ tag: tag.negate, operand: { tag: tag.negate, operand: left } })
        }
      }
      if (left.range !== undefined && right.range !== undefined) {
        let { low: a, high: b, is_nanable: left_is_nanable } = left.range
        let { low: c, high: d, is_nanable: right_is_nanable } = right.range
        const constant_fold_if_not_nan = (constant_value : 0 | 1) => {
          if (left_is_nanable) {
            // A < B (where there is a constant answer if neither one is NaN) => A * B * 0 + constant_value
            if (right_is_nanable) return initial_peephole_optimise({ tag: tag.add, left: { tag: tag.multiply, left: { tag: tag.multiply, left, right }, right: make_constant(0) }, right: make_constant(constant_value) })
            // A < B (where there is a constant answer if the left is not NaN) => B * 0 + constant_value
            return initial_peephole_optimise({ tag: tag.add, left: { tag: tag.multiply, left, right: make_constant(0) }, right: make_constant(constant_value) })
          } else if (right_is_nanable) {
            return initial_peephole_optimise({ tag: tag.add, left: { tag: tag.multiply, left: right, right: make_constant(0) }, right: make_constant(constant_value) })
          } else {
            return make_constant(constant_value)
          }
        }
        const non_constant = () => noop({ tag: node_tag, left, right}, { low: 0, high: 1, is_nanable: left_is_nanable || right_is_nanable })
        if (a === b && b === c && c === d) {
          switch (node_tag) {
            case tag.less: case tag.greater: case tag.notequal:
              return constant_fold_if_not_nan(0)
            case tag.lessequal: case tag.greaterequal: case tag.equal:
              return constant_fold_if_not_nan(1)
          }
        }
        if (b <= c) {
          // left is always <= right
          switch (node_tag) {
            case tag.less: return b < c ? constant_fold_if_not_nan(1) : non_constant()
            case tag.lessequal: return constant_fold_if_not_nan(1)
            case tag.greater: return b < c ? constant_fold_if_not_nan(0) : non_constant()
            case tag.greaterequal: return constant_fold_if_not_nan(0)
            case tag.equal: return b === c ? non_constant() : constant_fold_if_not_nan(0)
            case tag.notequal: return b === c ? non_constant() : constant_fold_if_not_nan(1)
          }
        }
        if (d <= a) {
          // left is always >= right
          switch (node_tag) {
            case tag.less: return d < a ? constant_fold_if_not_nan(0) : non_constant()
            case tag.lessequal: return constant_fold_if_not_nan(0)
            case tag.greater: return d < a ? constant_fold_if_not_nan(1) : non_constant()
            case tag.greaterequal: return constant_fold_if_not_nan(1)
            case tag.equal: return d === a ? non_constant() : constant_fold_if_not_nan(0)
            case tag.notequal: return d === a ? non_constant() : constant_fold_if_not_nan(1)
          }
        }
        // Some overlap
        return non_constant()
      }
      return noop({ tag: node_tag, left, right })
    }
    case tag.negate: {
      const operand = initial_peephole_optimise(node.operand)
      // -(c1) => -c1
      if (operand.tag === tag.constant) {
        const { amount } = operand
        return make_constant(amount === 0 ? 0 : -amount)
      }
      // -(-A) => A
      if (operand.tag === tag.negate) return operand.operand
      // -(A - B) => B - A
      if (operand.tag === tag.subtract) return initial_peephole_optimise({ tag: tag.subtract, left: operand.right, right: operand.left })
      // -(A * c1) => A * -c1
      if (operand.tag === tag.multiply && operand.right.tag === tag.constant) return initial_peephole_optimise({ tag: tag.multiply, left: operand.left, right: make_constant(-operand.right.amount) })
      // -(A + B) => -A + -B
      if (operand.tag === tag.add) return initial_peephole_optimise({ tag: tag.add, left: { tag: tag.negate, operand: operand.left }, right: { tag: tag.negate, operand: operand.right } })
      // -(NdS) => (-N)dS
      if (operand.tag === tag.dice) {
        operand.amount = -operand.amount
        if (operand.range !== undefined) {
          const temp = operand.range.low
          operand.range.low = -operand.range.high
          operand.range.high = -temp
        }
        return operand
      }
      if (operand.range !== undefined) {
        return noop({ tag: tag.negate, operand }, { low: -operand.range.high, high: -operand.range.low, is_nanable: operand.range.is_nanable })
      }
      return noop({ tag: tag.negate, operand })
    }
    case tag.boolean_not: {
      const operand = initial_peephole_optimise(node.operand)
      switch (operand.tag) {
        // !(c1) => !c1
        case tag.constant: return make_constant(+!operand.amount)
        // !(-A) => !A
        case tag.negate: return initial_peephole_optimise({ tag: tag.boolean_not, operand: operand.operand })
        // !(A < B) => A >= B
        // !(A > B) => A <= B
        // !(A <= B) => A > B
        // !(A >= B) => A < B
        // !(A = B) => A != B
        // !(A != B) => A = B
        case tag.less: case tag.greater: case tag.lessequal: case tag.greaterequal: case tag.equal: case tag.notequal:
          let opposite_tag
          switch (operand.tag) {
            case tag.less: opposite_tag = tag.greaterequal; break
            case tag.greater: opposite_tag = tag.lessequal; break
            case tag.lessequal: opposite_tag = tag.greater; break
            case tag.greaterequal: opposite_tag = tag.less; break
            case tag.equal: opposite_tag = tag.notequal; break
            case tag.notequal: opposite_tag = tag.equal; break
          }
          return initial_peephole_optimise({ tag: opposite_tag, left: operand.left, right: operand.right })
        // !(!A) => bool(A)
        case tag.boolean_not: return initial_peephole_optimise({ tag: tag.coerce_bool, operand: operand.operand })
        // !bool(A) => !A
        case tag.coerce_bool: return initial_peephole_optimise({ tag: tag.boolean_not, operand: operand.operand })
      }
      if (operand.range !== undefined) {
        const { low, high, is_nanable } = operand.range
        if (low === 0 && high === 0) {
          // assert(operand.range.is_nanable)
          return noop({ tag: tag.boolean_not, operand }, { low: 1, high: 1, is_nanable })
        }
        if (low <= 0 && 0 <= high) {
          return noop({ tag: tag.boolean_not, operand }, { low: 0, high: 1, is_nanable })
        }
        if (!is_nanable) {
          // Not possibly NaN, and always non-zero
          return make_constant(0)
        }
        return noop({ tag: tag.boolean_not, operand }, { low: 0, high: 0, is_nanable: true })
      }
      return noop({ tag: tag.boolean_not, operand })
    }
    case tag.coerce_bool: {
      const operand = initial_peephole_optimise(node.operand)
      switch (operand.tag) {
        // bool(E) => E  (if E is already a boolean expression)
        case tag.coerce_bool: case tag.boolean_not:
        case tag.less: case tag.greater: case tag.lessequal: case tag.greaterequal:
        case tag.equal: case tag.notequal:
          return operand
        // bool(c1) => bool(c1)
        case tag.constant:
          return Number.isNaN(operand.amount) || operand.amount === 0 ? operand : make_constant(1)
      }
      if (operand.range !== undefined) {
        const { low, high, is_nanable } = operand.range
        if ((low === 0 || low === 1) && (high === 0 || high === 1)) {
          // Already 0, 1 or NaN, coercion wouldn't change value
          return operand
        }
        if (low <= 0 && 0 <= high) {
          return noop({ tag: tag.coerce_bool, operand }, { low: 0, high: 1, is_nanable })
        }
        // Always non-zero
        if (!is_nanable) {
          // Not possibly NaN
          return make_constant(1)
        }
        return noop({ tag: tag.coerce_bool, operand }, { low: 1, high: 1, is_nanable: true })
      }
      return noop({ tag: tag.coerce_bool, operand }, { low: 0, high: 1, is_nanable: true })
    }
    case tag.conditional:
      const condition = initial_peephole_optimise(node.condition)
      if (condition.tag === tag.constant) {
        if (Number.isNaN(condition.amount)) return make_constant(NaN)
        return initial_peephole_optimise(condition.amount ? node.if_true : node.if_false)
      } else if (condition.tag === tag.dice) {
        // 0dN already optimized to constant 0
        return initial_peephole_optimise(node.if_true)
      } else if (condition.tag === tag.boolean_not) {
        // !E ? A : B => E ? B : A
        return initial_peephole_optimise({ tag: tag.conditional, condition: condition.operand, if_true: node.if_false, if_false: node.if_true })
      } else if (condition.tag === tag.coerce_bool) {
        // bool(E) ? A : B => E ? A : B
        return initial_peephole_optimise({ tag: tag.conditional, condition: condition.operand, if_true: node.if_true, if_false: node.if_false })
      }
      const if_true = initial_peephole_optimise(node.if_true)
      const if_false = initial_peephole_optimise(node.if_false)
      if (if_true.tag === tag.constant && if_false.tag === tag.constant) {
        const t = if_true.amount
        const f = if_false.amount
        if (Number.isNaN(t) || Number.isNaN(f)) {
          if (Number.isNaN(t) && Number.isNaN(f)) return make_constant(NaN)
        } else {
          // e ? n : n => is_NaN(e) ? NaN : n => (e * 0) + n
          if (t === f) return initial_peephole_optimise({ tag: tag.add, left: { tag: tag.multiply, left: condition, right: make_constant(0) }, right: make_constant(t) })
        }
      }
      if (if_true.tag === tag.constant) {
        const t = if_true.amount
        // e ? 0 : n => !e * n
        if (t === 0) return initial_peephole_optimise({ tag: tag.multiply, left: { tag: tag.boolean_not, operand: condition }, right: make_constant(t) } )
      }
      if (if_false.tag === tag.constant) {
        const f = if_false.amount
        // e ? n : 0 => bool(e) * n
        if (f === 0) return initial_peephole_optimise({ tag: tag.multiply, left: { tag: tag.coerce_bool, operand: condition }, right: make_constant(f) } )
      }
      const simplified_condition = initial_peephole_optimise({ tag: tag.coerce_bool, operand: condition })
      if (simplified_condition.range !== undefined && if_true.range !== undefined && if_false.range !== undefined) {
        const can_be_false = simplified_condition.range.low === 0
        const can_be_true = simplified_condition.range.high === 1
        if (can_be_false !== can_be_true) {
          // E ? A : B => (E * 0) + A  (where E is true or NaN)
          // E ? A : B => (E * 0) + B  (where E is false or NaN)
          return initial_peephole_optimise({ tag: tag.add, left: { tag: tag.multiply, left: condition, right: make_constant(0) }, right: can_be_true ? if_true : if_false })
        }
        return noop({ tag: tag.conditional, condition, if_true, if_false }, { low: Math.min(if_true.range.low, if_false.range.low), high: Math.max(if_true.range.high, if_false.range.high), is_nanable: simplified_condition.range.is_nanable || if_true.range.is_nanable || if_false.range.is_nanable })
      }
      return noop({ tag: tag.conditional, condition, if_true, if_false })
    case tag.min:
    case tag.max:
      // TODO: axe values that are clearly not going to win because of range
      // e.g.: min(1d6, 2d6, 3d6, 4d6, 20) => min(3d6, 4d6, 20), since 2d6 < 20
      const fn = node.tag === tag.max ? Math.max : Math.min
      const opposite_fn = node.tag === tag.max ? Math.min : Math.max
      let constant : number = opposite_fn(Infinity, -Infinity)
      let most_extreme_range : number | null = constant
      let least_extreme_range : number = -constant
      let is_nanable : boolean = false
      const args : tagged_expression_node[] = []
      for (const arg_unop of node.args) {
        const arg = initial_peephole_optimise(arg_unop)
        if (arg.tag === tag.constant) {
          if (Number.isNaN(arg.amount)) return make_constant(NaN)
          constant = fn(constant, arg.amount)
        } else if (arg.tag === node.tag) {
          // min(..., min(...), ...) => min(..., ..., ...)
          const inner_constant = arg.args[arg.args.length - 1]
          if (inner_constant.tag === tag.constant) {
            arg.args.pop()
            constant = fn(constant, inner_constant.amount)
          }
          args.push(...arg.args)
        } else {
          args.push(arg)
        }
        if (most_extreme_range !== null && arg.range !== undefined) {
          most_extreme_range = fn(most_extreme_range, arg.range.low, arg.range.high)
          least_extreme_range = opposite_fn(least_extreme_range, arg.range.low, arg.range.high)
          is_nanable = is_nanable || arg.range.is_nanable
        } else {
          most_extreme_range = null
        }
      }
      if (Number.isFinite(constant)) args.push(make_constant(constant))
      if (args.length === 1) return args[0]
      if (args.length === 0) return make_constant(NaN)
      if (most_extreme_range !== null) return noop({ tag: node.tag, args }, { low: Math.min(most_extreme_range, least_extreme_range), high: Math.max(most_extreme_range, least_extreme_range), is_nanable: is_nanable })
      return noop({ tag: node.tag, args })
  }
}

// Replace (A + (-B)) => A - B and remove tag
const finalise_peephole_optimise = (node : tagged_expression_node) : expression_node => {
  switch (node.tag) {
    case tag.constant: return { tag: tag.constant, amount: node.amount }
    case tag.dice:
      if (node.amount < 0) {
        node.amount = -node.amount
        return { tag: tag.negate, operand: finalise_peephole_optimise(node) }
      }
      if (node.keep === null) return { tag: tag.dice, amount: node.amount, sides: node.sides, keep: null }
      return { tag: tag.dice, amount: node.amount, sides: node.sides, keep: node.keep, keep_low: node.keep_low }
    case tag.add: {
      const left= finalise_peephole_optimise(node.left)
      const right = finalise_peephole_optimise(node.right)
      if (left.tag === tag.negate) {
        if (right.tag === tag.negate) {
          // -A + -B => -(A + B)
          return { tag: tag.negate, operand: { tag: tag.add, left: left.operand, right: right.operand } }
        }
        // -A + B => B - A
        return { tag: tag.subtract, left: right, right: left.operand }
      } else if (right.tag === tag.negate) {
        // A + -B => A - B
        return { tag: tag.subtract, left: left, right: right.operand }
      }
      return { tag: tag.add, left, right }
    }
    case tag.subtract: // Shouldn't be possible?
    case tag.multiply: case tag.floordivide: case tag.ceildivide:
    case tag.less: case tag.lessequal: case tag.greater: case tag.greaterequal: case tag.equal: case tag.notequal:
      return { tag: node.tag, left: finalise_peephole_optimise(node.left), right: finalise_peephole_optimise(node.right) }
    case tag.negate: case tag.boolean_not: case tag.coerce_bool:
      return { tag: node.tag, operand: finalise_peephole_optimise(node.operand) }
    case tag.conditional:
      return { tag: tag.conditional, condition: finalise_peephole_optimise(node.condition), if_true: finalise_peephole_optimise(node.if_true), if_false: finalise_peephole_optimise(node.if_false) }
    case tag.min: case tag.max:
      return { tag: node.tag, args: node.args.map(finalise_peephole_optimise) }
  }
}

export const peephole_optimise = (node : expression_node) : expression_node =>
  finalise_peephole_optimise(initial_peephole_optimise(node))

export const create_roll_function = (random : () => number = Math.random) => (sides : number) => 1 + sides * random()
export const roll_once = (node : expression_node, roll_function : (sides : number) => number = create_roll_function(Math.random)) : number => {
  switch (node.tag) {
    case tag.constant: return node.amount
    case tag.dice:
      const { amount, sides, keep } = node
      if (keep === null) {
        let total = 0
        for (let i = 0; i < amount; ++i) total += roll_function(sides)
        return total
      }
      const rolls = Array.from(Array(amount), () => roll_function(sides)).sort((a, b) => a - b)
      let lo
      let hi
      if (node.keep_low) {
        lo = 0
        hi = keep
      } else {
        lo = amount - keep
        hi = amount
      }
      let total = 0
      for (let i = lo; i < hi; ++i) total += rolls[i]
      return total
    case tag.add: case tag.subtract: case tag.multiply: case tag.floordivide: case tag.ceildivide:
    case tag.less: case tag.lessequal: case tag.greater: case tag.greaterequal: case tag.equal: case tag.notequal: {
      const left = roll_once(node.left, roll_function)
      const right = roll_once(node.right, roll_function)
      if (Number.isNaN(left) || Number.isNaN(right)) return NaN
      switch (node.tag) {
        case tag.add: return left + right
        case tag.subtract: return left - right
        case tag.multiply: return left * right
        case tag.floordivide: return Math.floor(left / right)
        case tag.ceildivide: return Math.ceil(left / right)
        case tag.less: return +(left < right)
        case tag.lessequal: return +(left <= right)
        case tag.greater: return +(left > right)
        case tag.greaterequal: return +(left >= right)
        case tag.equal: return +(left === right)
        case tag.notequal: return +(left !== right)
        default: return undefined as never
      }
    }
    case tag.negate: case tag.boolean_not: case tag.coerce_bool: {
      const operand = roll_once(node.operand, roll_function)
      if (Number.isNaN(operand)) return NaN
      switch (node.tag) {
        case tag.negate: return operand === 0 ? 0 : -operand
        case tag.boolean_not: return operand ? 0 : 1
        case tag.coerce_bool: return operand ? 1 : 0
        default: return undefined as never
      }
    }
    case tag.conditional: {
      const condition = roll_once(node.condition, roll_function)
      if (Number.isNaN(condition)) return NaN
      return roll_once(condition ? node.if_true : node.if_false, roll_function)
    }
    case tag.min: case tag.max:
      // min(..., NaN, ...) is NaN
      // max(..., NaN, ...) is NaN
      return (node.tag === tag.min ? Math.min : Math.max).apply(undefined, node.args.map(arg => roll_once(arg, roll_function)))
  }
}
