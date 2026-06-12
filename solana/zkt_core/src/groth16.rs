//! Vendored no_std Groth16 (BN254) verifier.
//!
//! Adapted from Light Protocol's `groth16-solana` 0.2.0 (MIT,
//! <https://github.com/Lightprotocol/groth16-solana>). Two changes make it drop
//! into a Quasar program (ADR-0004 found the upstream crate will not):
//!   * the `thiserror` error enum (links `std` → `duplicate lang item
//!     panic_impl` against Quasar's no_std panic handler) is replaced with a
//!     plain enum;
//!   * `num_bigint` (the public-input field-size check) is replaced with a
//!     constant big-endian comparison against the BN254 scalar-field modulus.
//!
//! Verification runs entirely on the `alt_bn128_*` syscalls (<200k CU). Inputs
//! are big-endian. `proof_a` must be negated before construction — use
//! [`negate_g1`]. Compatible with snarkjs/circom Groth16 proofs.

// alt_bn128 group-op selectors (big-endian inputs): G1 add, G1 mul, pairing.
const OP_G1_ADD: u64 = 0;
const OP_G1_MUL: u64 = 2;
const OP_PAIRING: u64 = 3;

/// Run an `alt_bn128` group operation, writing the `OUT`-byte result into a
/// fixed buffer (no allocation). On-chain this is the raw Solana syscall; on the
/// host it is emulated by `solana-bn254` (a `std` crate kept off the SBF build).
#[cfg(target_os = "solana")]
fn group_op<const OUT: usize>(op: u64, input: &[u8]) -> Result<[u8; OUT], ()> {
    use solana_define_syscall::definitions::sol_alt_bn128_group_op;
    let mut out = [0u8; OUT];
    // SAFETY: the syscall reads `input` (len bytes) and writes exactly `OUT`
    // bytes into `out` for these ops (G1 add/mul → 64, pairing → 32).
    let rc = unsafe {
        sol_alt_bn128_group_op(op, input.as_ptr(), input.len() as u64, out.as_mut_ptr())
    };
    if rc == 0 {
        Ok(out)
    } else {
        Err(())
    }
}

#[cfg(not(target_os = "solana"))]
fn group_op<const OUT: usize>(op: u64, input: &[u8]) -> Result<[u8; OUT], ()> {
    use solana_bn254::prelude::{
        alt_bn128_addition, alt_bn128_multiplication, alt_bn128_pairing,
    };
    let res = match op {
        OP_G1_ADD => alt_bn128_addition(input),
        OP_G1_MUL => alt_bn128_multiplication(input),
        OP_PAIRING => alt_bn128_pairing(input),
        _ => return Err(()),
    }
    .map_err(|_| ())?;
    res.try_into().map_err(|_| ())
}

/// BN254 scalar field (Fr) modulus, big-endian. Public inputs must be smaller.
const BN254_FR_MODULUS_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

/// BN254 base field (Fq) modulus, big-endian — the coordinate field, used to
/// negate a G1 point's y-coordinate.
const BN254_FQ_MODULUS_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Groth16Error {
    InvalidPublicInputsLength,
    PublicInputGreaterThanFieldSize,
    PreparingInputsG1MulFailed,
    PreparingInputsG1AdditionFailed,
    ProofVerificationFailed,
}

/// `true` iff `bytes` (big-endian) is strictly less than the BN254 Fr modulus.
/// Big-endian byte order makes a lexicographic compare equal to the numeric one.
pub fn is_less_than_bn254_field_size_be(bytes: &[u8; 32]) -> bool {
    for i in 0..32 {
        if bytes[i] < BN254_FR_MODULUS_BE[i] {
            return true;
        }
        if bytes[i] > BN254_FR_MODULUS_BE[i] {
            return false;
        }
    }
    false // equal ⇒ not strictly less
}

/// Negate a G1 point `(x, y)` in 64-byte uncompressed big-endian form, returning
/// `(x, q - y)` where `q` is the Fq modulus. Groth16's pairing check needs the
/// proof's A point negated. (Assumes `0 < y < q`, true for valid proof points.)
pub fn negate_g1(point: &[u8; 64]) -> [u8; 64] {
    let mut out = *point;
    // out[32..64] = BN254_FQ_MODULUS_BE - point[32..64], big-endian subtraction.
    let mut borrow: i16 = 0;
    let mut i = 32;
    while i > 0 {
        i -= 1;
        let d = BN254_FQ_MODULUS_BE[i] as i16 - point[32 + i] as i16 - borrow;
        if d < 0 {
            out[32 + i] = (d + 256) as u8;
            borrow = 1;
        } else {
            out[32 + i] = d as u8;
            borrow = 0;
        }
    }
    out
}

pub struct Groth16Verifyingkey<'a> {
    pub nr_pubinputs: usize,
    pub vk_alpha_g1: [u8; 64],
    pub vk_beta_g2: [u8; 128],
    pub vk_gamme_g2: [u8; 128],
    pub vk_delta_g2: [u8; 128],
    pub vk_ic: &'a [[u8; 64]],
}

pub struct Groth16Verifier<'a, const NR_INPUTS: usize> {
    proof_a: &'a [u8; 64],
    proof_b: &'a [u8; 128],
    proof_c: &'a [u8; 64],
    public_inputs: &'a [[u8; 32]; NR_INPUTS],
    prepared_public_inputs: [u8; 64],
    verifyingkey: &'a Groth16Verifyingkey<'a>,
}

impl<'a, const NR_INPUTS: usize> Groth16Verifier<'a, NR_INPUTS> {
    pub fn new(
        proof_a: &'a [u8; 64],
        proof_b: &'a [u8; 128],
        proof_c: &'a [u8; 64],
        public_inputs: &'a [[u8; 32]; NR_INPUTS],
        verifyingkey: &'a Groth16Verifyingkey<'a>,
    ) -> Result<Self, Groth16Error> {
        if public_inputs.len() + 1 != verifyingkey.vk_ic.len() {
            return Err(Groth16Error::InvalidPublicInputsLength);
        }
        Ok(Groth16Verifier {
            proof_a,
            proof_b,
            proof_c,
            public_inputs,
            prepared_public_inputs: [0u8; 64],
            verifyingkey,
        })
    }

    fn prepare_inputs<const CHECK: bool>(&mut self) -> Result<(), Groth16Error> {
        let mut prepared = self.verifyingkey.vk_ic[0];
        for (i, input) in self.public_inputs.iter().enumerate() {
            if CHECK && !is_less_than_bn254_field_size_be(input) {
                return Err(Groth16Error::PublicInputGreaterThanFieldSize);
            }
            // G1 mul: vk_ic[i+1] (64) ++ scalar (32) → G1 (64).
            let mut mul_input = [0u8; 96];
            mul_input[..64].copy_from_slice(&self.verifyingkey.vk_ic[i + 1]);
            mul_input[64..].copy_from_slice(input);
            let mul_res: [u8; 64] = group_op(OP_G1_MUL, &mul_input)
                .map_err(|_| Groth16Error::PreparingInputsG1MulFailed)?;
            // G1 add: mul_res (64) ++ accumulator (64) → G1 (64).
            let mut add_input = [0u8; 128];
            add_input[..64].copy_from_slice(&mul_res);
            add_input[64..].copy_from_slice(&prepared);
            prepared = group_op(OP_G1_ADD, &add_input)
                .map_err(|_| Groth16Error::PreparingInputsG1AdditionFailed)?;
        }
        self.prepared_public_inputs = prepared;
        Ok(())
    }

    /// Verify the proof, checking each public input is below the field size.
    pub fn verify(&mut self) -> Result<(), Groth16Error> {
        self.verify_common::<true>()
    }

    /// Verify the proof without the public-input field-size check.
    pub fn verify_unchecked(&mut self) -> Result<(), Groth16Error> {
        self.verify_common::<false>()
    }

    fn verify_common<const CHECK: bool>(&mut self) -> Result<(), Groth16Error> {
        self.prepare_inputs::<CHECK>()?;

        // Four pairs (G1 ++ G2) × (64 + 128) = 768 bytes:
        //   (A, B) (prepared_inputs, gamma) (C, delta) (alpha, beta)
        let mut pairing_input = [0u8; 768];
        let mut o = 0;
        for chunk in [
            &self.proof_a[..],
            &self.proof_b[..],
            &self.prepared_public_inputs[..],
            &self.verifyingkey.vk_gamme_g2[..],
            &self.proof_c[..],
            &self.verifyingkey.vk_delta_g2[..],
            &self.verifyingkey.vk_alpha_g1[..],
            &self.verifyingkey.vk_beta_g2[..],
        ] {
            pairing_input[o..o + chunk.len()].copy_from_slice(chunk);
            o += chunk.len();
        }

        let pairing_res: [u8; 32] = group_op(OP_PAIRING, &pairing_input)
            .map_err(|_| Groth16Error::ProofVerificationFailed)?;
        if pairing_res[31] != 1 {
            return Err(Groth16Error::ProofVerificationFailed);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub const VERIFYING_KEY: Groth16Verifyingkey = Groth16Verifyingkey {
        nr_pubinputs: 10,

        vk_alpha_g1: [
            45, 77, 154, 167, 227, 2, 217, 223, 65, 116, 157, 85, 7, 148, 157, 5, 219, 234, 51,
            251, 177, 108, 100, 59, 34, 245, 153, 162, 190, 109, 242, 226, 20, 190, 221, 80, 60,
            55, 206, 176, 97, 216, 236, 96, 32, 159, 227, 69, 206, 137, 131, 10, 25, 35, 3, 1, 240,
            118, 202, 255, 0, 77, 25, 38,
        ],

        vk_beta_g2: [
            9, 103, 3, 47, 203, 247, 118, 209, 175, 201, 133, 248, 136, 119, 241, 130, 211, 132,
            128, 166, 83, 242, 222, 202, 169, 121, 76, 188, 59, 243, 6, 12, 14, 24, 120, 71, 173,
            76, 121, 131, 116, 208, 214, 115, 43, 245, 1, 132, 125, 214, 139, 192, 224, 113, 36,
            30, 2, 19, 188, 127, 193, 61, 183, 171, 48, 76, 251, 209, 224, 138, 112, 74, 153, 245,
            232, 71, 217, 63, 140, 60, 170, 253, 222, 196, 107, 122, 13, 55, 157, 166, 154, 77, 17,
            35, 70, 167, 23, 57, 193, 177, 164, 87, 168, 199, 49, 49, 35, 210, 77, 47, 145, 146,
            248, 150, 183, 198, 62, 234, 5, 169, 213, 127, 6, 84, 122, 208, 206, 200,
        ],

        vk_gamme_g2: [
            25, 142, 147, 147, 146, 13, 72, 58, 114, 96, 191, 183, 49, 251, 93, 37, 241, 170, 73,
            51, 53, 169, 231, 18, 151, 228, 133, 183, 174, 243, 18, 194, 24, 0, 222, 239, 18, 31,
            30, 118, 66, 106, 0, 102, 94, 92, 68, 121, 103, 67, 34, 212, 247, 94, 218, 221, 70,
            222, 189, 92, 217, 146, 246, 237, 9, 6, 137, 208, 88, 95, 240, 117, 236, 158, 153, 173,
            105, 12, 51, 149, 188, 75, 49, 51, 112, 179, 142, 243, 85, 172, 218, 220, 209, 34, 151,
            91, 18, 200, 94, 165, 219, 140, 109, 235, 74, 171, 113, 128, 141, 203, 64, 143, 227,
            209, 231, 105, 12, 67, 211, 123, 76, 230, 204, 1, 102, 250, 125, 170,
        ],

        vk_delta_g2: [
            25, 142, 147, 147, 146, 13, 72, 58, 114, 96, 191, 183, 49, 251, 93, 37, 241, 170, 73,
            51, 53, 169, 231, 18, 151, 228, 133, 183, 174, 243, 18, 194, 24, 0, 222, 239, 18, 31,
            30, 118, 66, 106, 0, 102, 94, 92, 68, 121, 103, 67, 34, 212, 247, 94, 218, 221, 70,
            222, 189, 92, 217, 146, 246, 237, 9, 6, 137, 208, 88, 95, 240, 117, 236, 158, 153, 173,
            105, 12, 51, 149, 188, 75, 49, 51, 112, 179, 142, 243, 85, 172, 218, 220, 209, 34, 151,
            91, 18, 200, 94, 165, 219, 140, 109, 235, 74, 171, 113, 128, 141, 203, 64, 143, 227,
            209, 231, 105, 12, 67, 211, 123, 76, 230, 204, 1, 102, 250, 125, 170,
        ],

        vk_ic: &[
            [
                3, 183, 175, 189, 219, 73, 183, 28, 132, 200, 83, 8, 65, 22, 184, 81, 82, 36, 181,
                186, 25, 216, 234, 25, 151, 2, 235, 194, 13, 223, 32, 145, 15, 37, 113, 122, 93,
                59, 91, 25, 236, 104, 227, 238, 58, 154, 67, 250, 186, 91, 93, 141, 18, 241, 150,
                59, 202, 48, 179, 1, 53, 207, 155, 199,
            ],
            [
                46, 253, 85, 84, 166, 240, 71, 175, 111, 174, 244, 62, 87, 96, 235, 196, 208, 85,
                186, 47, 163, 237, 53, 204, 176, 190, 62, 201, 189, 216, 132, 71, 6, 91, 228, 97,
                74, 5, 0, 255, 147, 113, 161, 152, 238, 177, 78, 81, 111, 13, 142, 220, 24, 133,
                27, 149, 66, 115, 34, 87, 224, 237, 44, 162,
            ],
            [
                29, 157, 232, 254, 238, 178, 82, 15, 152, 205, 175, 129, 90, 108, 114, 60, 82, 162,
                37, 234, 115, 69, 191, 125, 212, 85, 176, 176, 113, 41, 23, 84, 8, 229, 196, 41,
                191, 243, 112, 105, 166, 75, 113, 160, 140, 34, 139, 179, 53, 180, 245, 195, 5, 24,
                42, 18, 82, 60, 173, 192, 67, 149, 211, 250,
            ],
            [
                18, 4, 92, 105, 55, 33, 222, 133, 144, 185, 99, 131, 167, 143, 52, 120, 44, 79,
                164, 63, 119, 223, 199, 154, 26, 86, 22, 208, 50, 53, 159, 65, 14, 171, 53, 159,
                255, 133, 91, 30, 162, 209, 152, 18, 251, 112, 105, 90, 65, 234, 44, 4, 42, 173,
                31, 230, 229, 137, 177, 112, 241, 142, 62, 176,
            ],
            [
                13, 117, 56, 250, 131, 38, 119, 205, 221, 228, 32, 185, 236, 82, 102, 29, 198, 53,
                117, 151, 19, 10, 255, 211, 41, 210, 72, 221, 79, 107, 251, 150, 35, 187, 30, 32,
                198, 17, 220, 4, 68, 10, 71, 51, 31, 169, 4, 174, 10, 38, 227, 229, 193, 129, 150,
                76, 94, 224, 182, 13, 166, 65, 175, 89,
            ],
            [
                21, 167, 160, 214, 213, 132, 208, 197, 115, 195, 129, 111, 129, 38, 56, 52, 41, 57,
                72, 249, 50, 187, 184, 49, 240, 228, 142, 147, 187, 96, 96, 102, 34, 163, 43, 218,
                199, 187, 250, 245, 119, 151, 237, 67, 231, 70, 236, 67, 157, 181, 216, 174, 25,
                82, 120, 255, 191, 89, 230, 165, 179, 241, 188, 218,
            ],
            [
                4, 136, 219, 130, 55, 89, 21, 224, 41, 30, 53, 234, 66, 160, 129, 174, 154, 139,
                151, 33, 163, 221, 150, 192, 171, 102, 241, 161, 48, 130, 31, 175, 6, 47, 176, 127,
                13, 8, 36, 228, 239, 219, 6, 158, 22, 31, 22, 162, 91, 196, 132, 188, 156, 228, 30,
                1, 178, 246, 197, 186, 236, 249, 236, 147,
            ],
            [
                9, 41, 120, 80, 67, 24, 240, 221, 136, 156, 137, 182, 168, 17, 176, 118, 119, 72,
                170, 188, 227, 31, 15, 22, 252, 37, 198, 154, 195, 163, 64, 125, 37, 211, 235, 67,
                249, 133, 45, 90, 162, 9, 173, 19, 80, 154, 208, 173, 221, 203, 206, 254, 81, 197,
                104, 26, 177, 78, 86, 210, 51, 116, 60, 87,
            ],
            [
                3, 41, 86, 208, 125, 147, 53, 187, 213, 220, 195, 141, 216, 40, 92, 137, 70, 210,
                168, 103, 105, 236, 85, 37, 165, 209, 246, 75, 122, 251, 75, 93, 28, 108, 154, 181,
                15, 16, 35, 88, 65, 211, 8, 11, 123, 84, 185, 187, 184, 1, 83, 141, 67, 46, 241,
                222, 232, 135, 59, 44, 152, 217, 237, 106,
            ],
            [
                34, 98, 189, 118, 119, 197, 102, 193, 36, 150, 200, 143, 226, 60, 0, 239, 21, 40,
                5, 156, 73, 7, 247, 14, 249, 157, 2, 241, 181, 208, 144, 0, 34, 45, 86, 133, 116,
                53, 235, 160, 107, 36, 195, 125, 122, 10, 206, 88, 85, 166, 62, 150, 65, 159, 130,
                7, 255, 224, 227, 229, 206, 138, 68, 71,
            ],
        ],
    };

    pub const PUBLIC_INPUTS: [[u8; 32]; 9] = [
        [
            34, 238, 251, 182, 234, 248, 214, 189, 46, 67, 42, 25, 71, 58, 145, 58, 61, 28, 116,
            110, 60, 17, 82, 149, 178, 187, 160, 211, 37, 226, 174, 231,
        ],
        [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 51,
            152, 17, 147,
        ],
        [
            4, 247, 199, 87, 230, 85, 103, 90, 28, 183, 95, 100, 200, 46, 3, 158, 247, 196, 173,
            146, 207, 167, 108, 33, 199, 18, 13, 204, 198, 101, 223, 186,
        ],
        [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7,
            49, 65, 41,
        ],
        [
            7, 130, 55, 65, 197, 232, 175, 217, 44, 151, 149, 225, 75, 86, 158, 105, 43, 229, 65,
            87, 51, 150, 168, 243, 176, 175, 11, 203, 180, 149, 72, 103,
        ],
        [
            46, 93, 177, 62, 42, 66, 223, 153, 51, 193, 146, 49, 154, 41, 69, 198, 224, 13, 87, 80,
            222, 171, 37, 141, 0, 1, 50, 172, 18, 28, 213, 213,
        ],
        [
            40, 141, 45, 3, 180, 200, 250, 112, 108, 94, 35, 143, 82, 63, 125, 9, 147, 37, 191, 75,
            62, 221, 138, 20, 166, 151, 219, 237, 254, 58, 230, 189,
        ],
        [
            33, 100, 143, 241, 11, 251, 73, 141, 229, 57, 129, 168, 83, 23, 235, 147, 138, 225,
            177, 250, 13, 97, 226, 162, 6, 232, 52, 95, 128, 84, 90, 202,
        ],
        [
            25, 178, 1, 208, 219, 169, 222, 123, 113, 202, 165, 77, 183, 98, 103, 237, 187, 93,
            178, 95, 169, 156, 38, 100, 125, 218, 104, 94, 104, 119, 13, 21,
        ],
    ];

    pub const PROOF: [u8; 256] = [
        45, 206, 255, 166, 152, 55, 128, 138, 79, 217, 145, 164, 25, 74, 120, 234, 234, 217, 68,
        149, 162, 44, 133, 120, 184, 205, 12, 44, 175, 98, 168, 172, 20, 24, 216, 15, 209, 175,
        106, 75, 147, 236, 90, 101, 123, 219, 245, 151, 209, 202, 218, 104, 148, 8, 32, 254, 243,
        191, 218, 122, 42, 81, 193, 84, 40, 57, 233, 205, 180, 46, 35, 111, 215, 5, 23, 93, 12, 71,
        118, 225, 7, 46, 247, 147, 47, 130, 106, 189, 184, 80, 146, 103, 141, 52, 242, 25, 0, 203,
        124, 176, 110, 34, 151, 212, 66, 180, 238, 151, 236, 189, 133, 209, 17, 137, 205, 183, 168,
        196, 92, 159, 75, 174, 81, 168, 18, 86, 176, 56, 16, 26, 210, 20, 18, 81, 122, 142, 104,
        62, 251, 169, 98, 141, 21, 253, 50, 130, 182, 15, 33, 109, 228, 31, 79, 183, 88, 147, 174,
        108, 4, 22, 14, 129, 168, 6, 80, 246, 254, 100, 218, 131, 94, 49, 247, 211, 3, 245, 22,
        200, 177, 91, 60, 144, 147, 174, 90, 17, 19, 189, 62, 147, 152, 18, 41, 139, 183, 208, 246,
        198, 118, 127, 89, 160, 9, 27, 61, 26, 123, 180, 221, 108, 17, 166, 47, 115, 82, 48, 132,
        139, 253, 65, 152, 92, 209, 53, 37, 25, 83, 61, 252, 42, 181, 243, 16, 21, 2, 199, 123, 96,
        218, 151, 253, 86, 69, 181, 202, 109, 64, 129, 124, 254, 192, 25, 177, 199, 26, 50,
    ];

    // Known-good vector above is from groth16-solana's own test suite. Running
    // it through OUR vendored verifier + negate_g1 proves the transcription is
    // bit-for-bit correct (the verifier math is otherwise a faithful copy of an
    // audited crate). These run on the host, where solana-bn254 emulates the
    // syscalls via arkworks.

    #[test]
    fn vendored_verifier_accepts_known_good_proof() {
        let proof_a: [u8; 64] = PROOF[0..64].try_into().unwrap();
        let proof_a_neg = negate_g1(&proof_a);
        let proof_b: [u8; 128] = PROOF[64..192].try_into().unwrap();
        let proof_c: [u8; 64] = PROOF[192..256].try_into().unwrap();
        let mut v =
            Groth16Verifier::new(&proof_a_neg, &proof_b, &proof_c, &PUBLIC_INPUTS, &VERIFYING_KEY)
                .unwrap();
        v.verify().unwrap();
        v.verify_unchecked().unwrap();
    }

    #[test]
    fn vendored_verifier_rejects_unnegated_proof() {
        let proof_a: [u8; 64] = PROOF[0..64].try_into().unwrap();
        let proof_b: [u8; 128] = PROOF[64..192].try_into().unwrap();
        let proof_c: [u8; 64] = PROOF[192..256].try_into().unwrap();
        let mut v =
            Groth16Verifier::new(&proof_a, &proof_b, &proof_c, &PUBLIC_INPUTS, &VERIFYING_KEY)
                .unwrap();
        assert_eq!(v.verify(), Err(Groth16Error::ProofVerificationFailed));
    }

    #[test]
    fn field_size_check_boundary() {
        assert!(is_less_than_bn254_field_size_be(&[0u8; 32]));
        assert!(!is_less_than_bn254_field_size_be(&BN254_FR_MODULUS_BE));
    }

    #[test]
    fn double_negation_is_identity() {
        let p: [u8; 64] = PROOF[0..64].try_into().unwrap();
        assert_eq!(negate_g1(&negate_g1(&p)), p);
    }
}
