import parser from './parser'
import lexer, { stringof_token } from './lexer'
import { peephole_optimise, stringof_expression_node } from './expression_node_transform'
import { compile, seed_engine } from './wasm_worker'
import { stringof_stackbytecode } from './stack_bytecode'

(typeof window === 'undefined' ? global : window as any).ready_instance = (str : string, seed : number | bigint | undefined = undefined) => {
    const lexed = lexer(str)
    console.log('Lexed tokens:')
    console.log(...lexed.map(i => stringof_token(i)))
    const parsed = parser(lexed)
    console.log('Parsed:')
    console.log(stringof_expression_node(parsed))
    const optimised = peephole_optimise(parsed)
    console.log('Optimised:')
    console.log(stringof_expression_node(optimised))

    const { generate, bytecode, stack_size } = compile(optimised, 512)
    console.log('Bytecode (stack_size = ' + stack_size + '):')
    console.log(bytecode.join(', '))
    console.log(stringof_stackbytecode(bytecode))

    seed_engine(seed)
    return generate
}
