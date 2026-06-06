const anchor = require("@anchor-lang/core");
const { Program, BN, AnchorProvider, Wallet, web3: { PublicKey, SystemProgram } } = anchor;
const { assert } = require("chai");

const ZKT_CORE_PROGRAM_ID = new PublicKey("HurjsoDphK87BtzNMUFZJUUGbxYe6fYxdtTAz3RXy9e4");

describe("zkt-core", () => {
  const provider = AnchorProvider.local("http://localhost:8899");
  anchor.setProvider(provider);
  const wallet = provider.wallet;

  const program = new Program(
    require("../target/idl/zkt_core.json"),
    provider,
  );

  const [organizerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("organizer"), wallet.publicKey.toBuffer()],
    ZKT_CORE_PROGRAM_ID
  );

  const [proposalPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), wallet.publicKey.toBuffer()],
    ZKT_CORE_PROGRAM_ID
  );

  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), wallet.publicKey.toBuffer()],
    ZKT_CORE_PROGRAM_ID
  );

  const [zakatPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zakat"), wallet.publicKey.toBuffer()],
    ZKT_CORE_PROGRAM_ID
  );

  it("applies as organizer", async () => {
    const tx = await program.methods
      .applyAsOrganizer("ipfs://test-metadata")
      .accountsPartial({
        applicant: wallet.publicKey,
        organizerState: organizerPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Apply organizer TX:", tx);

    const state = await program.account.organizerState.fetch(organizerPda);
    assert.equal(state.organizer.toString(), wallet.publicKey.toString());
    assert.equal(state.metadataUri, "ipfs://test-metadata");
    assert.deepEqual(state.status, { pending: {} });
  });

  it("review organizer - approve", async () => {
    const tx = await program.methods
      .reviewOrganizer(true)
      .accountsPartial({
        reviewer: wallet.publicKey,
        organizerState: organizerPda,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Review organizer TX:", tx);

    const state = await program.account.organizerState.fetch(organizerPda);
    assert.deepEqual(state.status, { approved: {} });
  });

  it("creates a proposal", async () => {
    const tx = await program.methods
      .createProposal("Zakat Campaign", "Help those in need", new BN(5000))
      .accountsPartial({
        organizer: wallet.publicKey,
        proposal: proposalPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Create proposal TX:", tx);

    const p = await program.account.proposal.fetch(proposalPda);
    assert.equal(p.title, "Zakat Campaign");
    assert.equal(p.fundingGoal.toNumber(), 5000);
    assert.deepEqual(p.status, { voting: {} });
  });

  it("casts a vote", async () => {
    const [votePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote"), proposalPda.toBuffer(), wallet.publicKey.toBuffer()],
      ZKT_CORE_PROGRAM_ID
    );

    const tx = await program.methods
      .castVote(true)
      .accountsPartial({
        voter: wallet.publicKey,
        proposal: proposalPda,
        vote: votePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Cast vote TX:", tx);

    const vote = await program.account.vote.fetch(votePda);
    assert.equal(vote.voter.toString(), wallet.publicKey.toString());
    assert.isTrue(vote.support);

    const p = await program.account.proposal.fetch(proposalPda);
    assert.equal(p.votesFor.toNumber(), 1);
  });

  it("finalizes the vote", async () => {
    const tx = await program.methods
      .finalizeVote()
      .accountsPartial({
        caller: wallet.publicKey,
        proposal: proposalPda,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Finalize vote TX:", tx);

    const p = await program.account.proposal.fetch(proposalPda);
    assert.deepEqual(p.status, { approved: {} });
  });

  it("creates a campaign pool", async () => {
    const tx = await program.methods
      .createCampaignPool(new BN(10000))
      .accountsPartial({
        organizer: wallet.publicKey,
        pool: poolPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Create pool TX:", tx);

    const pool = await program.account.campaignPool.fetch(poolPda);
    assert.equal(pool.fundingGoal.toNumber(), 10000);
  });

  it("donates to pool", async () => {
    const [donorPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("donor"), poolPda.toBuffer(), wallet.publicKey.toBuffer()],
      ZKT_CORE_PROGRAM_ID
    );

    const tx = await program.methods
      .donate(new BN(1000))
      .accountsPartial({
        donor: wallet.publicKey,
        pool: poolPda,
        donorRecord: donorPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Donate TX:", tx);

    const pool = await program.account.campaignPool.fetch(poolPda);
    assert.equal(pool.raisedAmount.toNumber(), 1000);

    const record = await program.account.donorRecord.fetch(donorPda);
    assert.equal(record.amount.toNumber(), 1000);
  });

  it("creates a zakat pool", async () => {
    const tx = await program.methods
      .createZakatPool(new BN(5000))
      .accountsPartial({
        organizer: wallet.publicKey,
        zakatPool: zakatPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Create zakat pool TX:", tx);

    const pool = await program.account.zakatPool.fetch(zakatPda);
    assert.equal(pool.fundingGoal.toNumber(), 5000);
  });

  it("donates to zakat pool", async () => {
    const tx = await program.methods
      .donateZakat(new BN(500))
      .accountsPartial({
        donor: wallet.publicKey,
        zakatPool: zakatPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Donate zakat TX:", tx);

    const pool = await program.account.zakatPool.fetch(zakatPda);
    assert.equal(pool.raisedAmount.toNumber(), 500);
  });

  it("submits sharia review", async () => {
    const [reviewPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("review"), wallet.publicKey.toBuffer()],
      ZKT_CORE_PROGRAM_ID
    );

    const tx = await program.methods
      .submitShariaReview(
        new PublicKey("11111111111111111111111111111111"),
        "ipfs://review-metadata"
      )
      .accountsPartial({
        proposer: wallet.publicKey,
        review: reviewPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Submit review TX:", tx);

    const review = await program.account.review.fetch(reviewPda);
    assert.isDefined(review.status.pending);
  });

  it("approves sharia review", async () => {
    const [reviewPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("review"), wallet.publicKey.toBuffer()],
      ZKT_CORE_PROGRAM_ID
    );

    const tx = await program.methods
      .reviewSharia(true)
      .accountsPartial({
        reviewer: wallet.publicKey,
        review: reviewPda,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Approve review TX:", tx);

    const review = await program.account.review.fetch(reviewPda);
    assert.deepEqual(review.status, { approved: {} });
  });

  it("submits milestone vote", async () => {
    const [mvotePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mvote"), proposalPda.toBuffer(), wallet.publicKey.toBuffer()],
      ZKT_CORE_PROGRAM_ID
    );

    const tx = await program.methods
      .submitMilestoneVote(new BN(1), true)
      .accountsPartial({
        voter: wallet.publicKey,
        proposal: proposalPda,
        milestoneVote: mvotePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Milestone vote TX:", tx);

    const mv = await program.account.milestoneVote.fetch(mvotePda);
    assert.equal(mv.milestoneId.toNumber(), 1);
    assert.isTrue(mv.support);
  });
});
