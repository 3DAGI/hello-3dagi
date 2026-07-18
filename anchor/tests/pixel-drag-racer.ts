// Happy-path test for the Pixel Drag Racer program.
// Run with: anchor test (needs solana-test-validator + anchor toolchain)

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

describe("pixel-drag-racer", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PixelDragRacer as Program;
  const me = provider.wallet.publicKey;

  const config = PublicKey.findProgramAddressSync(
    [Buffer.from("config")], program.programId)[0];
  const mint = PublicKey.findProgramAddressSync(
    [Buffer.from("fuel")], program.programId)[0];
  const board = (season: number) => PublicKey.findProgramAddressSync(
    [Buffer.from("season"), new BN(season).toArrayLike(Buffer, "le", 2)],
    program.programId)[0];
  const player = (w: PublicKey) => PublicKey.findProgramAddressSync(
    [Buffer.from("player"), w.toBuffer()], program.programId)[0];

  it("initializes", async () => {
    await program.methods
      .initialize(new BN(14 * 86400), new BN(10_000_000), 500)
      .accounts({ admin: me, config, mint, board: board(0) })
      .rpc();
  });

  it("registers without referrer", async () => {
    await program.methods
      .register(null)
      .accounts({ authority: me, config, player: player(me), referrerPlayer: null })
      .rpc();
  });

  it("submits a time and lands on the board", async () => {
    await program.methods
      .submitTime(13242, 0)
      .accounts({
        authority: me, config,
        player: player(me), board: board(0), referrerPlayer: null,
      })
      .rpc();
    const b: any = await program.account.seasonBoard.fetch(board(0));
    if (b.entries[0].etMs !== 13242) throw new Error("board entry missing");
    const p: any = await program.account.player.fetch(player(me));
    if (p.claimable.toNumber() !== 10_000_000) throw new Error("no PB reward");
  });

  it("claims FUEL", async () => {
    const ata = getAssociatedTokenAddressSync(mint, me);
    await program.methods
      .claim()
      .accounts({ authority: me, config, mint, player: player(me), playerAta: ata })
      .rpc();
    const bal = await provider.connection.getTokenAccountBalance(ata);
    if (bal.value.amount !== "10000000") throw new Error("claim failed");
  });

  it("joins and leaves the ranked queue", async () => {
    const queue = PublicKey.findProgramAddressSync(
      [Buffer.from("queue")], program.programId)[0];
    const qvault = PublicKey.findProgramAddressSync(
      [Buffer.from("qvault")], program.programId)[0];
    const ata = getAssociatedTokenAddressSync(mint, me);

    await program.methods
      .queueJoin(new BN(1_000_000)) // 1 FUEL
      .accounts({
        authority: me, config, mint, player: player(me),
        queue, qvault, authorityAta: ata,
      })
      .rpc();
    let q: any = await program.account.rankedQueue.fetch(queue);
    if (!q.slots.some((s: any) => s.player.equals(me))) throw new Error("not queued");

    await program.methods
      .queueLeave()
      .accounts({ authority: me, queue, qvault, authorityAta: ata })
      .rpc();
    q = await program.account.rankedQueue.fetch(queue);
    if (q.slots.some((s: any) => s.player.equals(me))) throw new Error("still queued");
  });
});
