// Synchronise this with stack_bytecode.ts
enum class bytecode_value : unsigned char {
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
};

using uint64_t = unsigned long long;
using int64_t = long long;
using uint32_t = unsigned int;
using int32_t = int;
using random_type = uint64_t;
// Exported functions
#ifdef __wasm__
[[clang::export_name("seed_engine")]]
#endif
extern "C" void seed_engine(random_type seed);
#ifdef __wasm__
[[clang::export_name("evaluate")]]
#endif
extern "C" void evaluate(const unsigned char* bytecode, uint32_t bytecode_size, int64_t* stack, uint32_t amount);

static_assert(sizeof(uint64_t) == 8, "long long not 64-bit");
static_assert(~uint64_t{0} == 0xffff'ffff'ffff'ffffULL, "unsigned long long max not 64-bit max");
static_assert(sizeof(uint32_t) == 4, "int not 32-bit");
static_assert(~uint32_t{0} == 0xffff'ffffULL, "unsigned max not 32-bit max");

namespace {

struct dice_roller_type {
  [[gnu::always_inline]]
  constexpr explicit dice_roller_type(uint32_t upper_bound) noexcept : scale_factor(random_type(-1) / upper_bound), overflow(scale_factor * upper_bound - 1ull) {}
  [[gnu::always_inline]] constexpr dice_roller_type(const dice_roller_type&) noexcept = default;

  [[gnu::always_inline]] inline uint32_t operator()() noexcept;

  random_type scale_factor;
  random_type overflow;
};

extern "C" {
  inline random_type gen_random();
  [[gnu::noinline]] inline uint32_t roll_dice(dice_roller_type dice_roller) {
      random_type result;
      do {
        result = gen_random();
      } while (result > dice_roller.overflow);
      return uint32_t(result / dice_roller.scale_factor) + 1u;
    }
}

[[gnu::always_inline]] uint32_t dice_roller_type::operator()() noexcept {
  return roll_dice(*this);
}

[[gnu::always_inline]] dice_roller_type get_dice_roller(uint32_t upper_bound) noexcept {
  return dice_roller_type(upper_bound);
}

}

namespace {
[[gnu::always_inline]]
inline constexpr int64_t floor_divide(int64_t a, int64_t b) noexcept {
  return a / b + (a % b != 0 && ((a >= 0) == (b >= 0)));
}
[[gnu::always_inline]]
inline constexpr int64_t ceil_divide(int64_t a, int64_t b) noexcept {
  return a / b - (a % b != 0 && ((a < 0) != (b < 0)));
}
[[gnu::always_inline]]
inline constexpr int64_t min(int64_t a, int64_t b) noexcept {
  return a < b ? a : b;
}
[[gnu::always_inline]]
inline constexpr int64_t min(int64_t a, int64_t b, int64_t c) noexcept {
  return a < b ? min(a, c) : min(b, c);
}
[[gnu::always_inline]]
inline constexpr int64_t max(int64_t a, int64_t b) noexcept {
  return a > b ? a : b;
}
[[gnu::always_inline]]
inline constexpr int64_t max(int64_t a, int64_t b, int64_t c) noexcept {
  return a > b ? max(a, c) : max(b, c);
}
[[gnu::always_inline]]
inline uint32_t read_constant(const unsigned char*& p) noexcept {
  uint32_t u = static_cast<uint32_t>(*p++) << 24;
  u |= static_cast<uint32_t>(*p++) << 16;
  u |= static_cast<uint32_t>(*p++) << 8;
  u |= *p++;
  return u;
}

struct greater {
  [[gnu::always_inline]] constexpr bool operator()(int64_t l, int64_t r) const noexcept { return l > r; }
};

struct less {
  [[gnu::always_inline]] constexpr bool operator()(int64_t l, int64_t r) const noexcept { return l < r; }
};

[[gnu::always_inline]]
inline int64_t sum(const int64_t* first, const int64_t* last) noexcept {
  int64_t result = 0;
  while (first != last) result += *first++;
  return result;
}

template<typename T>
[[gnu::always_inline]] inline void swap(T& l, T& r) noexcept {
  T temp(static_cast<T&&>(l));
  l = static_cast<T&&>(r);
  r = static_cast<T&&>(temp);
}

// Heap functions
using ptrdiff_t = decltype(static_cast<char*>(nullptr) - static_cast<char*>(nullptr));
[[gnu::always_inline]] inline constexpr ptrdiff_t parent_index(ptrdiff_t i) noexcept { return (--i) >>= 1; }
[[gnu::always_inline]] inline constexpr ptrdiff_t left_child(ptrdiff_t i) noexcept { return ++(i <<= 1); }

// Assuming both the left child and right child of root are valid heaps, sift the root node down so the heap is valid from root
template<typename Cmp>
[[gnu::always_inline]] inline void do_sift_down(int64_t* first, ptrdiff_t size, ptrdiff_t root, Cmp cmp) noexcept {
    ptrdiff_t child;
    while ((child = left_child(root)) < size) {
      // Switch to right child if that is greater
      if (child+1 < size && cmp(first[child], first[child+1])) ++child;

      // Swap root with greater child and continue sifting
      if (!cmp(first[child], first[root])) {
        swap(first[root], first[child]);

        root = child;
      } else {
        // Heap invariants held
        return;
      }
    }
}

extern "C" {
[[gnu::noinline]] inline void sift_down_less(int64_t* first, ptrdiff_t size, ptrdiff_t root) noexcept { do_sift_down(first, size, root, less{}); }
[[gnu::noinline]] inline void sift_down_greater(int64_t* first, ptrdiff_t size, ptrdiff_t root) noexcept { do_sift_down(first, size, root, greater{}); }
}

[[gnu::always_inline]] inline void sift_down(int64_t* first, ptrdiff_t size, ptrdiff_t root, less) noexcept { sift_down_less(first, size, root); }
[[gnu::always_inline]] inline void sift_down(int64_t* first, ptrdiff_t size, ptrdiff_t root, greater) noexcept { sift_down_greater(first, size, root); }

template<typename Cmp>
[[gnu::always_inline]] inline void make_heap(int64_t* first, ptrdiff_t size, Cmp cmp) noexcept {
  if (size <= 1) return;  // 0 or 1 elements are already a heap
  ptrdiff_t start = parent_index(size);
  while (start > 0) {
    --start;
    sift_down(first, size, start, cmp);
  }
}

template<typename Cmp>
[[gnu::always_inline]] inline void replace_heap(int64_t* first, ptrdiff_t size, int64_t new_element, Cmp cmp) noexcept {
  if (!cmp(new_element, *first)) {
    // Would not be in the heap
    return;
  }
  *first = new_element;
  sift_down(first, size, 0, cmp);
}

}

extern "C" void evaluate(const unsigned char* bytecode, uint32_t bytecode_size, int64_t* stack, uint32_t amount) {
  const unsigned char* const bytecode_end = bytecode + bytecode_size;
  while (bytecode != bytecode_end) {
    switch (static_cast<bytecode_value>(*bytecode++)) {
#define OPERATOR(ARITY, NAME, OP_EXPR) \
      case bytecode_value:: NAME: { \
        stack -= (unsigned(ARITY)-1u)*amount; \
        for (int64_t* p = stack-amount; p != stack; ++p) OP_EXPR; \
        break; \
      }
#define BINARY_OPERATOR_COMPOUND(NAME, OP) OPERATOR(2, NAME, *p = *p OP p[amount])
      BINARY_OPERATOR_COMPOUND(op_add, +)
      BINARY_OPERATOR_COMPOUND(op_subtract, -)
      BINARY_OPERATOR_COMPOUND(op_multiply, *)
      OPERATOR(2, op_floordivide, *p = floor_divide(*p, p[amount]))
      OPERATOR(2, op_ceildivide, *p = ceil_divide(*p, p[amount]))
      OPERATOR(1, op_negate, *p = -*p)
      BINARY_OPERATOR_COMPOUND(op_lt, <)
      BINARY_OPERATOR_COMPOUND(op_le, <=)
      BINARY_OPERATOR_COMPOUND(op_gt, >)
      BINARY_OPERATOR_COMPOUND(op_ge, >=)
      BINARY_OPERATOR_COMPOUND(op_eq, ==)
      BINARY_OPERATOR_COMPOUND(op_ne, !=)
      OPERATOR(1, op_min2, *p = ::min(*p, p[amount]))
      OPERATOR(3, op_min3, *p = ::min(*p, p[amount], p[amount*2u]))
      OPERATOR(2, op_max2, *p = ::max(*p, p[amount]))
      OPERATOR(3, op_max3, *p = ::max(*p, p[amount], p[amount*2u]))
      OPERATOR(3, op_conditional, *p = *p ? p[amount] : p[amount*2u])
      OPERATOR(1, op_coerce_bool, *p = static_cast<bool>(*p))
      OPERATOR(1, op_boolean_not, *p = !*p)
      case bytecode_value::op_push_constant: {
        stack += amount;
        int64_t constant{read_constant(bytecode)};
        for (int64_t* p = stack-amount; p != stack; ++p) *p = constant;
        break;
      }
      case bytecode_value::op_roll_simple: {
        stack += amount;
        uint32_t n = read_constant(bytecode);
        uint32_t sides = read_constant(bytecode);
        auto roll = get_dice_roller(sides);
        for (int64_t* p = stack-amount; p != stack; ++p) *p = roll();
        if (n != 1u) {
          for (int64_t* p = stack-amount; p != stack; ++p) {
            for (uint64_t i = 1; i < n; ++i) {
              *p += roll();
            }
          }
        }
        break;
      }
      case bytecode_value::op_roll_kl:
      case bytecode_value::op_roll_kh: {
        bytecode_value op = static_cast<bytecode_value>(bytecode[-1]);
        const uint32_t n = read_constant(bytecode);
        const uint32_t sides = read_constant(bytecode);
        const uint32_t keep = read_constant(bytecode);
        const ptrdiff_t heap_size = keep;
        const int64_t* const heaps_end = stack + amount*heap_size;
        auto roll = get_dice_roller(sides);
        for (int64_t* p = stack; p != heaps_end; ++p) *p = roll();
        auto f = [&](auto cmp) -> void {
          for (int64_t* p = stack; p != heaps_end; p += heap_size) {
            make_heap(p, heap_size, cmp);
            // Generate n total dice rolls; already generated heap_size
            for (ptrdiff_t i = heap_size; i < n; ++i) {
              // Remove result not in highest (keep) dice; add new result
              replace_heap(p, heap_size, roll(), cmp);
            }
          }
        };
        if (op == bytecode_value::op_roll_kl) f(less{});
        else f(greater{});
        for (unsigned i = 0; i < amount; ++i) {
          const int64_t* const heap_start = stack + i*heap_size;
          stack[i] = sum(heap_start, heap_start + heap_size);
        }
        stack += amount;
        break;
      }
      default: __builtin_unreachable();
    }
  }
}

// PRNG is the Mersenne Twister with parameters equivalent to std::mt19937_64
// This was eventually adapted into
// https://github.com/MitalAshok/freestanding_mersenne_twister
using size_t = decltype(sizeof(char));
namespace {

static constexpr size_t word_size = 64;  // w
static constexpr size_t state_size = 312;  // n
static constexpr size_t shift_size = 156;  // m
static constexpr size_t mask_bits = 31;  // r
static constexpr random_type xor_mask{0xb502'6f5a'a966'19e9uLL};  // a
static constexpr size_t tempering_u = 29;  // u
static constexpr random_type tempering_d{0x5555'5555'5555'5555uLL};  // d
static constexpr size_t tempering_s = 17;  // s
static constexpr random_type tempering_b{0x71d6'7fff'eda6'0000uLL};  // b
static constexpr size_t tempering_t = 37;  // t
static constexpr random_type tempering_c{0xfff7'eee0'0000'0000uLL};  // c
static constexpr size_t tempering_l = 43;  // l
static constexpr random_type initialization_multiplier{6'364'136'223'846'793'005uLL};  // f
static constexpr random_type default_seed = 5489u;

struct random_state_t {
    [[gnu::always_inline]] constexpr random_state_t() noexcept : random_state_t(default_seed) {}
    [[gnu::always_inline]] explicit constexpr random_state_t(random_type seed) noexcept : raw_state{} { do_seed(seed); }

    [[gnu::always_inline]] constexpr void do_seed(random_type seed) noexcept {
      index = state_size;
      auto& X = raw_state;
      X[0] = seed;
      // for i = 1-n, ..., -1, X[i] = [f * (X[i-1] xor (X[i-1] >> (w-2)) + (i mod n)] mod 2^w
      // let j = i + n; X[i] == X[j] since i === j (mod n)
      // mod 2^64 is implicit in random_state being a uint64_t
      // for j = 1, ..., n-1, X[j] = [f * (X[j-1] xor (X[j-1] >> (w-2)) + j]
      for (size_t j = 1; j < state_size; ++j) {
        X[j] = initialization_multiplier * (X[j-1u] xor (X[j-1u] >> (word_size - 2u))) + j;
      }
    }

    random_type raw_state[state_size];
    size_t index = 0;
};

extern "C" {
  static random_state_t random_state;
}

[[gnu::always_inline]] void transition_state() noexcept {
  constexpr random_type upper_bits_mask{(~random_type{0}) << mask_bits};
  constexpr random_type lower_bits_mask{(~random_type{0}) ^ upper_bits_mask};

  constexpr auto& X = random_state.raw_state;
  for (size_t i = 0; i < (state_size - shift_size); ++i) {
    random_type Y = (X[i] & upper_bits_mask) | (X[i+1u] & lower_bits_mask);
    random_type alpha = xor_mask * (Y bitand 1);
    X[i] = X[i + shift_size] xor (Y >> 1) xor alpha;
  }

  for (size_t i = (state_size - shift_size); i < state_size - 1u; ++i) {
    random_type Y = (X[i] & upper_bits_mask) | (X[i+1u] & lower_bits_mask);
    random_type alpha = xor_mask * (Y bitand 1);
    X[i] = X[i + (shift_size - state_size)] xor (Y >> 1) xor alpha;
  }

  random_type Y = (X[state_size - 1u] & upper_bits_mask) | (X[0] & lower_bits_mask);
  random_type alpha = xor_mask * (Y bitand 1);
  X[state_size - 1u] = X[shift_size - 1u] xor (Y >> 1) xor alpha;

  random_state.index = 0;
}

}

extern "C" void seed_engine(random_type seed) { random_state.do_seed(seed); }

extern "C" {
  namespace {
  [[gnu::always_inline]] inline random_type gen_random() {
    auto i = random_state.index++;
    if (i == state_size) [[unlikely]] {
        transition_state();
        i = 0;
        random_state.index = 1;
    }

    random_type z = random_state.raw_state[i];
    z = z xor ((z >> tempering_u) bitand tempering_d);
    z = z xor ((z << tempering_s) bitand tempering_b);
    z = z xor ((z << tempering_t) bitand tempering_c);
    z = z xor (z >> tempering_l);
    return z;
  }
  }
}

#ifndef __wasm__

int main() {
  // Take from the console. Bytecode (stack_size = ...):, next line is the bytecode
  constexpr size_t stack_size = ...;
  constexpr size_t amount = 4;
  alignas(0x1000) unsigned char bytecode[] = {
    ...
  };
  alignas(0x1000) int64_t stack[ amount * stack_size];
  evaluate(bytecode, sizeof(bytecode), stack, amount);

  for (size_t i = 0; i < (size_t) amount; ++i) {
    __builtin_printf(i == 0 ? "%lld" : " %lld", stack[i]);
  }
  __builtin_printf("\n");
}

#endif
