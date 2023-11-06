import { expression_node } from './expression_nodes'
import { bytecode_precalculate_length, stringof_stackbytecode, to_bytecode } from './stack_bytecode'
//@ts-ignore
import wasmData from '../dist/evaluate.wasm'

const initial_memory = 2
const memory = new WebAssembly.Memory({ initial: initial_memory })
const module = await WebAssembly.instantiateStreaming(fetch(wasmData), {
  env: {
    memory,
  }
})

;(typeof window === 'undefined' ? global : window as any).memory = memory
;(typeof window === 'undefined' ? global : window as any).module = module

export const seed_engine = (value : number | bigint | undefined = undefined) => {
  ;(module.instance.exports.seed_engine as (value: bigint) => void)(value == null ? 5489n : BigInt(value))
}

export const compile = (e : expression_node, amount : number = 512) : {
  generate: () => BigInt64Array,
  bytecode: Uint8Array,
  stack_size: number
} => {
  const bytecode_length = bytecode_precalculate_length(e)
  const bytecode_offset = initial_memory * 65536
  const padded_bytecode = Math.ceil(bytecode_length / 65536)
  {
    const space_needed = initial_memory + padded_bytecode
    const existing_space = memory.buffer.byteLength / 65536
    if (existing_space < space_needed) memory.grow(space_needed - existing_space)
  }
  let bytecode = new Uint8Array(memory.buffer, bytecode_offset, bytecode_length)
  let i = 0
  const stack_size = to_bytecode(e, byte => bytecode[i++] = byte)
  //@ts-ignore
  ;(typeof window === 'undefined' ? global : window as any).stack_size = stack_size
  const padded_stack_size = Math.ceil(stack_size * ((amount * 8) / 65536))
  const space_needed =  initial_memory + padded_bytecode + padded_stack_size
  const existing_space = memory.buffer.byteLength / 65536
  if (existing_space < space_needed) {
    memory.grow(space_needed - existing_space)
    bytecode = new Uint8Array(memory.buffer, bytecode_offset, bytecode_length)
  }
  const stack_offset = (initial_memory + padded_bytecode) * 65536

  return {
    generate: () => {
      // void evaluate(unsigned char* bytecode, uint32_t bytecode_size, int64_t* stack, uint32_t amount)
      ;(module.instance.exports.evaluate as (bytecode: number, bytecode_size: number, stack: number, amount: number) => void)(
          bytecode_offset, bytecode_length,
          stack_offset, amount
      )
      return new BigInt64Array(memory.buffer, stack_offset, amount)
    },
    bytecode,
    stack_size
  }
}
