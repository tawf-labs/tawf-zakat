const fs = require('fs');
const { utils } = require('ffjavascript');
const { unstringifyBigInts, leInt2Buff } = utils;

// big-endian 32 bytes from a decimal string
const be = (s) => Array.from(leInt2Buff(unstringifyBigInts(s), 32)).reverse();
const g1 = (p) => be(p[0]).concat(be(p[1]));                 // x||y  (64)
const g2 = (p) => be(p[0][1]).concat(be(p[0][0]))            // x_c1||x_c0
                   .concat(be(p[1][1])).concat(be(p[1][0])); // y_c1||y_c0  (128)
const row = (a) => a.join(', ');

const vk = JSON.parse(fs.readFileSync('verification_key.json'));
const pr = JSON.parse(fs.readFileSync('tv_proof.json'));
const pub = JSON.parse(fs.readFileSync('tv_public.json'));

let out = '';
out += `// AUTO-GENERATED dev test vector (throwaway — regenerate after the ceremony).\n`;
out += `// Real proof of zakat_eligibility.circom; public signals\n`;
out += `// [nullifier, nisab, currentTime, campaignId, cycleId].\n\n`;

out += `const TV_VK_IC: [[u8; 64]; ${vk.IC.length}] = [\n`;
for (const ic of vk.IC) out += `    [${row(g1(ic))}],\n`;
out += `];\n`;
out += `const TV_VK: Groth16Verifyingkey = Groth16Verifyingkey {\n`;
out += `    nr_pubinputs: ${vk.IC.length},\n`;
out += `    vk_alpha_g1: [${row(g1(vk.vk_alpha_1))}],\n`;
out += `    vk_beta_g2: [${row(g2(vk.vk_beta_2))}],\n`;
out += `    vk_gamme_g2: [${row(g2(vk.vk_gamma_2))}],\n`;
out += `    vk_delta_g2: [${row(g2(vk.vk_delta_2))}],\n`;
out += `    vk_ic: &TV_VK_IC,\n};\n`;

const proof = g1(pr.pi_a).concat(g2(pr.pi_b)).concat(g1(pr.pi_c));
out += `const TV_PROOF: [u8; 256] = [${row(proof)}];\n`;

out += `const TV_SIGNALS: [[u8; 32]; 5] = [\n`;
for (const s of pub) out += `    [${row(be(s))}],\n`;
out += `];\n`;

fs.writeFileSync('tv_rust.txt', out);
console.log('wrote tv_rust.txt; proof len', proof.length, 'vk_ic', vk.IC.length);
