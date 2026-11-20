/**
 * Exact IEEE-754 binary64 round-half-to-even matching Python's built-in `round(x, ndigits)`.
 */

const _buf = new ArrayBuffer(8);
const _view = new DataView(_buf);

/**
 * Round a finite IEEE-754 number using binary64 exact representation and round-half-to-even.
 *
 * @param {number} value
 * @param {number} [ndigits=2]
 * @returns {number}
 */
export function pyRound(value, ndigits = 2) {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;

  const digits = Math.trunc(ndigits);
  _view.setFloat64(0, value, false);
  const bits = _view.getBigUint64(0, false);

  const sign = (bits >> 63n) === 1n ? -1 : 1;
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const fracBits = bits & 0xfffffffffffffn;

  const mantissa = expBits === 0 ? fracBits : (1n << 52n) | fracBits;
  const exp = expBits === 0 ? -1074 : expBits - 1075;

  if (digits >= 0) {
    if (exp >= 0) {
      return value === 0 ? 0 : value;
    }
    const shift = BigInt(-exp);
    const scale = 10n ** BigInt(digits);
    const num = mantissa * scale;
    const den = 1n << shift;

    let q = num / den;
    const r = num % den;
    const half = den >> 1n;

    if (r > half || (r === half && (q & 1n) === 1n)) {
      q += 1n;
    }
    if (q === 0n) return 0;

    const prefix = sign < 0 ? "-" : "";
    return digits === 0 ? Number(`${prefix}${q}`) : Number(`${prefix}${q}e-${digits}`);
  }

  const scale = 10n ** BigInt(-digits);
  let num;
  let den;
  if (exp >= 0) {
    num = mantissa << BigInt(exp);
    den = scale;
  } else {
    num = mantissa;
    den = scale << BigInt(-exp);
  }

  let q = num / den;
  const r = num % den;
  const twiceR = r * 2n;
  if (twiceR > den || (twiceR === den && (q & 1n) === 1n)) {
    q += 1n;
  }
  if (q === 0n) return 0;

  const prefix = sign < 0 ? "-" : "";
  return Number(`${prefix}${q}e${-digits}`);
}
