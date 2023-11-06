import { expression_node, tag } from './expression_nodes'
import { parentype, stringof_token, tokentag, tokentype } from './lexer'

class Parser {
  private position = 0
  private tokens : tokentype[]
  constructor(tokens : tokentype[]) {
    this.tokens = tokens
  }

  public parse() : expression_node {
    const tokens = this.tokens
    this.position = 0
    if (tokens.length === 0) return { tag: tag.constant, amount: 0 }
    const expression = this.parse_subexpression()
    const position = this.position
    if (position < tokens.length) throw RangeError('Unexpected extra tokens after expression after ' + stringof_token(tokens[position]))
    return expression
  }

  private consume_token<T extends tokentag>(expected_tag : T, context : string | (() => string)) : Extract<tokentype, { [0]: T }> {
    return this.consume_exact_token([ expected_tag ] as unknown as Extract<tokentype, { [0]: T }>, context)
  }

  private consume_exact_token<T extends tokentype>(expected_tag : T, context : string | (() => string)) : T {
    const { position, tokens } = this
    const error_prefix = () => {
      return 'xpected ' + stringof_token(expected_tag) + ' after ' + (typeof context === 'string' ? context : context())
    }
    if (position >= tokens.length)
      throw RangeError('Unexpected end of expression; e' + error_prefix())
    const token = tokens[position]
    for (let i = 0; i < expected_tag.length; ++i) {
      if (expected_tag[i] !== token[i]) {
        throw RangeError('E' + error_prefix() + ', not ' + stringof_token(token))
      }
    }
    ++this.position
    return token as T
  }

  private try_consume_token<T extends tokentag>(...expected_tags : T[]) : T | null {
    const { position, tokens } = this
    if (position >= tokens.length) return null
    const token = tokens[position]
    const actual_tag = tokens[position][0]
    for (const tag of expected_tags) {
      if (tag === actual_tag) {
        ++this.position
        return tag
      }
    }
    return null
  }

  private try_consume_exact_tokens<T extends tokentype>(...expected_tokens : T[]) : T | null {
    const { position, tokens } = this
    if (position >= tokens.length) return null
    const actual_token = tokens[position]
    for (const expected_token of expected_tokens) {
      let match = true
      for (let i = 0; i < expected_token.length; ++i) {
        if (expected_token[i] !== actual_token[i]) {
          match = false
          break
        }
      }
      if (match) {
        ++this.position
        return actual_token as T
      }
    }
    return null
  }

  private parse_subexpression() : expression_node {
    const { position, tokens } = this
    if (this.position >= tokens.length) throw RangeError('Unexpected end of expression after ' + stringof_token(tokens[tokens.length - 1]))

    const token = tokens[position]
    const tag = token[0]
    switch (tag) {
      case tokentag.kh:
      case tokentag.kl:
      case tokentag.dh:
      case tokentag.dl:
        throw RangeError(stringof_token(token) + ' must be to the right of dice expression')
      case tokentag.lteq:
      case tokentag.gteq:
      case tokentag.lt:
      case tokentag.gt:
      case tokentag.eq:
      case tokentag.bangeq:
      case tokentag.rparen:
      case tokentag.asterisk:
      case tokentag.forwardslash:
      case tokentag.backslash:
      case tokentag.question:
      case tokentag.colon:
      case tokentag.comma:
        throw RangeError(stringof_token(token) + ' must have an expression to the left')
      case tokentag.bang:
      case tokentag.number:
      case tokentag.lparen:
      case tokentag.d:
      case tokentag.plus:
      case tokentag.dash:
      case tokentag.max:
      case tokentag.min:
        return this.parse_conditional_expression()
    }
  }

  // Functions in order of priority
  private parse_conditional_expression() : expression_node {
    const condition = this.parse_relational_expression()
    if (this.try_consume_token(tokentag.question) === null) return condition
    const if_true = this.parse_subexpression()
    this.consume_token(tokentag.colon, 'conditional expression\'s first case')
    const if_false = this.parse_subexpression()
    return { tag: tag.conditional, condition, if_true, if_false }
  }

  private parse_relational_expression() : expression_node {
    let node = this.parse_additive_expression()
    while (true) {
      const operator_token = this.try_consume_token(tokentag.lt, tokentag.gt, tokentag.gteq, tokentag.lteq, tokentag.eq, tokentag.bangeq)
      if (operator_token === null) break
      let operator_tag : tag.less | tag.lessequal | tag.greater | tag.greaterequal | tag.equal | tag.notequal
      switch (operator_token) {
        case tokentag.lt: operator_tag = tag.less; break
        case tokentag.gt: operator_tag = tag.greater; break
        case tokentag.gteq: operator_tag = tag.greaterequal; break
        case tokentag.lteq: operator_tag = tag.lessequal; break
        case tokentag.eq: operator_tag = tag.equal; break
        case tokentag.bangeq: operator_tag = tag.notequal; break
      }
      node = { tag: operator_tag, left: node, right: this.parse_additive_expression() }
    }
    return node
  }

  private parse_additive_expression() : expression_node {
    let node = this.parse_multiplicative_expression()
    while (true) {
      const operator_token = this.try_consume_token(tokentag.plus, tokentag.dash)
      if (operator_token === null) break
      let operator_tag : tag.add | tag.subtract
      switch (operator_token) {
        case tokentag.plus: operator_tag = tag.add; break
        case tokentag.dash: operator_tag = tag.subtract; break
      }
      node = { tag: operator_tag, left: node, right: this.parse_multiplicative_expression() }
    }
    return node
  }

  private parse_multiplicative_expression() : expression_node {
    let node = this.parse_unary_op_expression()
    while (true) {
      const operator_token = this.try_consume_token(tokentag.asterisk, tokentag.forwardslash, tokentag.backslash)
      if (operator_token === null) break
      let operator_tag : tag.multiply | tag.floordivide | tag.ceildivide
      switch (operator_token) {
        case tokentag.asterisk: operator_tag = tag.multiply; break
        case tokentag.forwardslash: operator_tag = tag.floordivide; break
        case tokentag.backslash: operator_tag = tag.ceildivide; break
      }
      node = { tag: operator_tag, left: node, right: this.parse_unary_op_expression() }
    }
    return node
  }

  private parse_unary_op_expression() : expression_node {
    switch (this.try_consume_token(tokentag.dash, tokentag.plus, tokentag.bang)) {
      case tokentag.plus:
        ++this.position
        // +expr is the same as expr
        return this.parse_unary_op_expression()
      case null:
        return this.parse_parenthesised_expression()
      case tokentag.dash:
        return { tag: tag.negate, operand: this.parse_unary_op_expression() }
      case tokentag.bang:
        return { tag: tag.boolean_not, operand: this.parse_unary_op_expression() }
    }
  }

  private parse_parenthesised_expression() : expression_node {
    const paren = this.try_consume_exact_tokens([ tokentag.lparen ] as any as [ tokentag.lparen, parentype ])
    if (paren !== null) {
      const parenthesised = this.parse_subexpression()
      this.consume_exact_token([ tokentag.rparen, paren[1] ], 'parenthesised expression')
      return parenthesised
    }
    return this.parse_dice_expression()
  }

  private parse_dice_expression() : expression_node {
    let amount = this.try_parse_constant()
    if (this.try_consume_token(tokentag.d) !== null) {
      if (amount === null) amount = 1
      const sides = this.try_parse_constant()
      if (sides === null) throw RangeError('d must be followed by number of sides on dice (e.g., d20)')
      const next_token = this.try_consume_token(tokentag.dh, tokentag.dl, tokentag.kh, tokentag.kl)
      if (next_token === null) return { tag: tag.dice, amount, sides, keep: null }
      let dropping : boolean
      let keep_low : boolean
      switch (next_token) {
        case tokentag.dh: dropping = true; keep_low = true; break
        case tokentag.dl: dropping = true; keep_low = false; break
        case tokentag.kl: dropping = false; keep_low = true; break
        case tokentag.kh: dropping = false; keep_low = false; break
      }
      let keep = this.try_parse_constant()
      if (keep === null) keep = 1  // 2d20kh == 2d20kh1

      if (dropping) keep = amount - keep
      return { tag: tag.dice, amount, sides, keep: Math.min(Math.max(keep, 0), amount), keep_low }
    } else if (amount !== null) {
      return { tag: tag.constant, amount }
    }

    return this.parse_function()
  }

  private try_parse_constant() : number | null {
    const { position, tokens } = this
    if (position >= tokens.length) return null
    const token = tokens[position]
    if (token[0] === tokentag.number) {
      ++this.position
      return token[1]
    }
    return null
  }

  private parse_function() : expression_node {
    const function_token = this.try_consume_token(tokentag.min, tokentag.max)
    if (function_token === null) {
      const { position, tokens } = this
      if (position < tokens.length) {
        throw RangeError('Expected expression after ' + stringof_token(tokens[position]))
      }
      throw RangeError('Expected expression')
    }

    const [ _, parentype ] = this.consume_token(tokentag.lparen as const, () => stringof_token([ function_token ]))
    const args : expression_node[] = []
    do {
      args.push(this.parse_subexpression())
    } while (this.try_consume_token(tokentag.comma) !== null)
    this.consume_exact_token([ tokentag.rparen, parentype ], () => stringof_token([ function_token ]))
    switch (function_token) {
      case tokentag.min:
        return { tag: tag.min, args }
      case tokentag.max:
        return { tag: tag.max, args }
    }
  }
}

export default (tokens : tokentype[]) : expression_node => {
  return (new Parser(tokens)).parse()
}
