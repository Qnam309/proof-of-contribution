import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { keccak256, stringToHex, zeroAddress } from "viem";

const { viem, networkHelpers } = await hre.network.create();
const HASH = keccak256(stringToHex("Portaldot V3 Beginner Guide"));
const OTHER_HASH = keccak256(stringToHex("Another contribution"));
const ZERO_HASH = `0x${"00".repeat(32)}` as const;
const URI = "https://example.org/guide";

async function fixture() {
  const accounts = await viem.getWalletClients();
  const [admin, author, reviewer, outsider] = accounts;
  const registry = await viem.deployContract("ContributionRegistry", [], { client: { wallet: admin } });
  return { registry, admin, author, reviewer, outsider };
}

async function submit(registry: Awaited<ReturnType<typeof fixture>>["registry"], author: Awaited<ReturnType<typeof fixture>>["author"]) {
  await registry.write.submitContribution([HASH, URI], { account: author.account });
}

async function approve(registry: Awaited<ReturnType<typeof fixture>>["registry"], admin: Awaited<ReturnType<typeof fixture>>["admin"], reviewer: Awaited<ReturnType<typeof fixture>>["reviewer"]) {
  await registry.write.setReviewer([reviewer.account.address, true], { account: admin.account });
  await registry.write.approveContribution([1n], { account: reviewer.account });
}

describe("ContributionRegistry", () => {
  it("sets deployer as admin and starts count at 1", async () => {
    const { registry, admin } = await networkHelpers.loadFixture(fixture);
    assert.equal((await registry.read.admin()).toLowerCase(), admin.account.address.toLowerCase());
    assert.equal(await registry.read.nextId(), 1n);
  });

  it("accepts a contribution and returns pending metadata", async () => {
    const { registry, author } = await networkHelpers.loadFixture(fixture);
    await submit(registry, author);
    const item = await registry.read.getContribution([1n]);
    assert.equal(item.contributor.toLowerCase(), author.account.address.toLowerCase());
    assert.equal(item.contentHash, HASH);
    assert.equal(item.evidenceURI, URI);
    assert.equal(item.status, 1);
    assert.equal(await registry.read.nextId(), 2n);
    assert.equal(await registry.read.verifyContribution([1n, HASH]), false);
  });

  it("rejects empty hashes, evidence URI and oversized URI", async () => {
    const { registry, author } = await networkHelpers.loadFixture(fixture);
    await viem.assertions.revertWith(registry.write.submitContribution([ZERO_HASH, URI], { account: author.account }), "Empty hash");
    await viem.assertions.revertWith(registry.write.submitContribution([HASH, ""], { account: author.account }), "Invalid evidence URI");
    await viem.assertions.revertWith(registry.write.submitContribution([HASH, "a".repeat(513)], { account: author.account }), "Invalid evidence URI");
  });

  it("blocks duplicate hash from same author", async () => {
    const { registry, author } = await networkHelpers.loadFixture(fixture);
    await submit(registry, author);
    await viem.assertions.revertWith(registry.write.submitContribution([HASH, URI], { account: author.account }), "Duplicate hash");
  });

  it("allows different author to submit same hash", async () => {
    const { registry, author, outsider } = await networkHelpers.loadFixture(fixture);
    await submit(registry, author);
    await registry.write.submitContribution([HASH, URI], { account: outsider.account });
    assert.equal(await registry.read.nextId(), 3n);
  });

  it("allows only admin to grant or revoke reviewer status", async () => {
    const { registry, admin, reviewer, outsider } = await networkHelpers.loadFixture(fixture);
    await viem.assertions.revertWith(registry.write.setReviewer([reviewer.account.address, true], { account: outsider.account }), "Only admin");
    await viem.assertions.revertWith(registry.write.setReviewer([zeroAddress, true], { account: admin.account }), "Invalid reviewer");
    await registry.write.setReviewer([reviewer.account.address, true], { account: admin.account });
    assert.equal(await registry.read.reviewers([reviewer.account.address]), true);
    await registry.write.setReviewer([reviewer.account.address, false], { account: admin.account });
    assert.equal(await registry.read.reviewers([reviewer.account.address]), false);
  });

  it("prevents outsider approval", async () => {
    const { registry, author, outsider } = await networkHelpers.loadFixture(fixture);
    await submit(registry, author);
    await viem.assertions.revertWith(registry.write.approveContribution([1n], { account: outsider.account }), "Not an authorized reviewer");
  });

  it("prevents self-review even with reviewer privileges", async () => {
    const { registry, admin, author } = await networkHelpers.loadFixture(fixture);
    await submit(registry, author);
    await registry.write.setReviewer([author.account.address, true], { account: admin.account });
    await viem.assertions.revertWith(registry.write.approveContribution([1n], { account: author.account }), "Self review forbidden");
  });

  it("approves and verifies only the matching hash", async () => {
    const { registry, admin, author, reviewer } = await networkHelpers.loadFixture(fixture);
    await submit(registry, author);
    await approve(registry, admin, reviewer);
    const item = await registry.read.getContribution([1n]);
    assert.equal(item.status, 2);
    assert.equal(item.reviewer.toLowerCase(), reviewer.account.address.toLowerCase());
    assert.ok(item.reviewedAt > 0n);
    assert.equal(await registry.read.verifyContribution([1n, HASH]), true);
    assert.equal(await registry.read.verifyContribution([1n, OTHER_HASH]), false);
  });

  it("rejects a contribution and verification stays false", async () => {
    const { registry, admin, author, reviewer } = await networkHelpers.loadFixture(fixture);
    await submit(registry, author);
    await registry.write.setReviewer([reviewer.account.address, true], { account: admin.account });
    await registry.write.rejectContribution([1n], { account: reviewer.account });
    assert.equal((await registry.read.getContribution([1n])).status, 3);
    assert.equal(await registry.read.verifyContribution([1n, HASH]), false);
  });

  it("prevents double review or a changed decision", async () => {
    const { registry, admin, author, reviewer } = await networkHelpers.loadFixture(fixture);
    await submit(registry, author);
    await approve(registry, admin, reviewer);
    await viem.assertions.revertWith(registry.write.approveContribution([1n], { account: reviewer.account }), "Already reviewed");
    await viem.assertions.revertWith(registry.write.rejectContribution([1n], { account: reviewer.account }), "Already reviewed");
  });

  it("prevents non-existing review and rejects non-existing reads", async () => {
    const { registry, admin, reviewer } = await networkHelpers.loadFixture(fixture);
    await registry.write.setReviewer([reviewer.account.address, true], { account: admin.account });
    await viem.assertions.revertWith(registry.write.approveContribution([99n], { account: reviewer.account }), "Contribution not found");
    await viem.assertions.revertWith(registry.read.getContribution([99n]), "Contribution not found");
    assert.equal(await registry.read.verifyContribution([99n, HASH]), false);
  });

  it("prevents revoked reviewers from reviewing", async () => {
    const { registry, admin, author, reviewer } = await networkHelpers.loadFixture(fixture);
    await submit(registry, author);
    await registry.write.setReviewer([reviewer.account.address, true], { account: admin.account });
    await registry.write.setReviewer([reviewer.account.address, false], { account: admin.account });
    await viem.assertions.revertWith(registry.write.approveContribution([1n], { account: reviewer.account }), "Not an authorized reviewer");
  });
});
