export const enum tokentag {
  number = 1,
  kh,
  kl,
  dh,
  dl,
  d,
  lparen,
  rparen,
  lteq,
  gteq,
  lt,
  gt,
  eq,
  bangeq,
  bang,
  plus,
  dash,
  asterisk,
  forwardslash,
  backslash,
  question,
  colon,
  comma,
  max,
  min,
}
export const enum parentype {
  round = 1,
  square,
  squiggly
}

const lex = (str : string) => {
  return Array.from(str.matchAll(/([0-9]+)|([a-z]+)|([<>!=]=?)|([+\-*?:(){}\[\],/\\])|(\S)/gis), match => {
    if (match[1]) {
      const n = +match[1]
      // assert(n >= 0)
      if (n > 0xFFFFFFFF) throw RangeError('Numbers in diceroll input must be smaller than 4 billion (' + match[1] + ' is too large)')
      return [ tokentag.number, n ] as readonly [ tokentag.number, number ]
    } else if (match[2]) {
      switch (match[2].toLowerCase()) {
        case 'kh': return [ tokentag.kh ] as const
        case 'kl': return [ tokentag.kl ] as const
        case 'dh': return [ tokentag.dh ] as const
        case 'dl': return [ tokentag.dl ] as const
        case 'd': return [ tokentag.d ] as const
        case 'max': return [ tokentag.max ] as const
        case 'min': return [ tokentag.min ] as const
      }
    } else if (match[3]) {
      switch (match[3]) {
        case '<': return [ tokentag.lt ] as const
        case '>': return [ tokentag.gt ] as const
        case '<=': return [ tokentag.lteq ] as const
        case '>=': return [ tokentag.gteq ] as const
        case '=': return [ tokentag.eq ] as const
        case '!=': return [ tokentag.bangeq ] as const
        case '!': return [ tokentag.bang ] as const
      }
    } else if (match[4]) {
      switch (match[4]) {
        case '+': return [ tokentag.plus ] as const
        case '-': return [ tokentag.dash ] as const
        case '*': return [ tokentag.asterisk ] as const
        case '?': return [ tokentag.question ] as const
        case ':': return [ tokentag.colon ] as const
        case '(': return [ tokentag.lparen, parentype.round ] as const
        case ')': return [ tokentag.rparen, parentype.round ] as const
        case '[': return [ tokentag.lparen, parentype.square ] as const
        case ']': return [ tokentag.rparen, parentype.square ] as const
        case '{': return [ tokentag.lparen, parentype.squiggly ] as const
        case '}': return [ tokentag.rparen, parentype.squiggly ] as const
        case ',': return [ tokentag.comma ] as const
        case '/': return [ tokentag.forwardslash ] as const
        case '\\': return [ tokentag.backslash ] as const
      }
    }

    throw RangeError('Invalid characters in diceroll input: "' + match[0] + '"')
  })
}


type tokenarraytype = ReturnType<typeof lex>
export type tokentype = tokenarraytype extends readonly (infer T)[] ? T : never
export default (str : string) : tokentype[] => lex(str)

export const stringof_token = (token : tokentype) : string => {
  switch (token[0]) {
    case tokentag.number: return '' + token[1]
    case tokentag.kh: return 'kh'
    case tokentag.kl: return 'kl'
    case tokentag.dh: return 'dh'
    case tokentag.dl: return 'dl'
    case tokentag.d: return 'd'
    case tokentag.lparen: return '([{'[token[1] - parentype.round]
    case tokentag.rparen: return ')]}'[token[1] - parentype.round]
    case tokentag.lteq: return '<='
    case tokentag.gteq: return '>='
    case tokentag.lt: return '<'
    case tokentag.gt: return '>'
    case tokentag.eq: return '='
    case tokentag.bangeq: return '!='
    case tokentag.bang: return '!'
    case tokentag.plus: return '+'
    case tokentag.dash: return '-'
    case tokentag.asterisk: return '*'
    case tokentag.question: return '?'
    case tokentag.colon: return ':'
    case tokentag.comma: return ','
    case tokentag.forwardslash: return '/'
    case tokentag.backslash: return '\\'
    case tokentag.max: return 'max'
    case tokentag.min: return 'min'
  }
}
