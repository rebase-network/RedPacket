const BigNumber = require('bignumber.js')
// const Web3 = require('web3')
const chai = require('chai')
const expect = chai.expect
chai.use(require('chai-as-promised'))
const helper = require('./helper')
const {
    creation_success_encode,
    creation_success_types,
    claim_success_encode,
    claim_success_types,
    refund_success_encode,
    refund_success_types,
    public_key,
    private_key,
    eth_address,
} = require('./constants')

const TestToken = artifacts.require('TestToken');
const TestTokenERC1155 = artifacts.require('TestTokenERC1155');
const BurnToken = artifacts.require('BurnToken');
const HappyRedPacket = artifacts.require('HappyRedPacket')

contract('HappyRedPacket', accounts => {
  let snapShot
  let snapshotId
  let testtoken
  let burntoken
  let redpacket
  let creationParams

  beforeEach(async () => {
    snapShot = await helper.takeSnapshot()
    snapshotId = snapShot['result']
    testtoken = await TestToken.deployed()
    burntoken = await BurnToken.deployed()
    testTokenERC1155 = await TestTokenERC1155.deployed()
    redpacket = await HappyRedPacket.deployed()

    creationParams = {
      public_key: public_key,
      number: 3,
      ifrandom: true,
      duration: 1000,
      seed: web3.utils.sha3('lajsdklfjaskldfhaikl'),
      message: 'Hi',
      name: 'cache',
      token_type: 0,
      token_addr: eth_address,
      total_tokens: 100000000,
      erc1155Address: testTokenERC1155.address,
      erc1155TokenId: 1
    }
    await testTokenERC1155.setApprovalForAll.sendTransaction(redpacket.address, true, { from: accounts[0] })
  })

  afterEach(async () => {
    await helper.revertToSnapShot(snapshotId)
  })

  describe('refund() test', async () => {
    it('should throw error when the refunder is not creator', async () => {
      const { redPacketInfo } = await createThenGetClaimParams(accounts[1])
      await expect(
        redpacket.refund.sendTransaction(redPacketInfo.id, {
          from: accounts[1],
        }),
      ).to.be.rejectedWith(getRevertMsg('Creator Only'))
    })

    it('should throw error before expiry', async () => {
      const { redPacketInfo } = await createThenGetClaimParams(accounts[1])
      await expect(
        redpacket.refund.sendTransaction(redPacketInfo.id, {
          from: accounts[0],
        }),
      ).to.be.rejectedWith(getRevertMsg('Not expired yet'))
    })

    it("should throw error when there's no remaining", async () => {
      creationParams.number = 1
      const { claimParams, redPacketInfo } = await createThenGetClaimParams(accounts[1])
      await redpacket.claim.sendTransaction(...Object.values(claimParams), {
        from: accounts[1],
      })
      const availability = await redpacket.check_availability.call(redPacketInfo.id, { from: accounts[1] })
      expect(Number(availability.total)).to.be.eq(Number(availability.claimed))
      expect(Number(availability.balance)).to.be.eq(0)
      await helper.advanceTimeAndBlock(2000)
      await expect(
        redpacket.refund.sendTransaction(redPacketInfo.id, {
          from: accounts[0],
        }),
      ).to.be.rejectedWith(getRevertMsg('None left in the red packet'))
    })

    it('should throw error when already refunded', async () => {
      const { claimParams, redPacketInfo } = await createThenGetClaimParams(accounts[1])
      await redpacket.claim.sendTransaction(...Object.values(claimParams), {
        from: accounts[1],
      })

      await helper.advanceTimeAndBlock(2000)

      await redpacket.refund.sendTransaction(redPacketInfo.id, {
        from: accounts[0],
      })

      await expect(
        redpacket.refund.sendTransaction(redPacketInfo.id, {
          from: accounts[0],
        }),
      ).to.be.rejectedWith(getRevertMsg('None left in the red packet'))
    })

    it('should refund eth successfully', async () => {
      const { claimParams, redPacketInfo } = await createThenGetClaimParams(accounts[1])
      const balance1 = await testTokenERC1155.balanceOf.call(redpacket.address, 1)
      console.log('1111 ========= balance1: ', Number(balance1))
      expect(Number(balance1)).to.be.gt(0)

      await redpacket.claim.sendTransaction(...Object.values(claimParams), {
        from: accounts[1],
      })

      await helper.advanceTimeAndBlock(2000)
      const balance2 = await testTokenERC1155.balanceOf.call(redpacket.address, 1)
      console.log(' ========= balance2: ', Number(balance2))
      expect(Number(balance1) - Number(balance2)).to.be.eq(1)

      await redpacket.refund.sendTransaction(redPacketInfo.id, {
        from: accounts[0],
      })
      const balance3 = await testTokenERC1155.balanceOf.call(redpacket.address, 1)
      console.log(' ========= balance3: ', Number(balance3))
      expect(Number(balance3)).to.be.eq(0)
      expect(Number(balance2) - Number(balance3)).to.be.eq(2)
    })

    it('should refund eth successfully (not random)', async () => {
      creationParams.ifrandom = false
      const { claimParams, redPacketInfo } = await createThenGetClaimParams(accounts[1])
      const balance1 = await testTokenERC1155.balanceOf.call(redpacket.address, 1)
      console.log('22222 ========= balance1: ', Number(balance1))
      expect(Number(balance1)).to.be.gt(0)

      await redpacket.claim.sendTransaction(...Object.values(claimParams), {
        from: accounts[1],
      })

      await helper.advanceTimeAndBlock(2000)

      await redpacket.refund.sendTransaction(redPacketInfo.id, {
        from: accounts[0],
      })
      const result = await getRefundRedPacketInfo()
      expect(result)
        .to.have.property('id')
        .that.to.be.eq(redPacketInfo.id)
      expect(result)
        .to.have.property('token_address')
        .that.to.be.eq(eth_address)
      expect(Number(result.remaining_balance)).to.be.eq(66666667)

      const balance3 = await testTokenERC1155.balanceOf.call(redpacket.address, 1)
      console.log(' ========= balance3: ', Number(balance3))
      expect(Number(balance3)).to.be.eq(0)
      expect(Number(balance1) - Number(balance3)).to.be.eq(3)
    })

    it('should refund erc20 successfully', async () => {
      creationParams.ifrandom = false
      creationParams.token_type = 1
      creationParams.token_addr = testtoken.address

      await testtoken.transfer(accounts[0], creationParams.total_tokens)
      await testtoken.approve.sendTransaction(redpacket.address, creationParams.total_tokens, { from: accounts[0] })

      const { claimParams, redPacketInfo } = await createThenGetClaimParams(accounts[1])
      const balance1 = await testTokenERC1155.balanceOf.call(redpacket.address, 1)
      console.log('33333 ========= balance1: ', Number(balance1))
      expect(Number(balance1)).to.be.gt(0)

      await redpacket.claim.sendTransaction(...Object.values(claimParams), {
        from: accounts[1],
      })

      await helper.advanceTimeAndBlock(2000)

      await redpacket.refund.sendTransaction(redPacketInfo.id, {
        from: accounts[0],
      })
      const result = await getRefundRedPacketInfo()
      expect(result)
        .to.have.property('id')
        .that.to.be.eq(redPacketInfo.id)
      expect(result)
        .to.have.property('token_address')
        .that.to.be.eq(testtoken.address)
      expect(Number(result.remaining_balance)).to.be.eq(66666667)

      const allowance = await testtoken.allowance(redpacket.address, accounts[0])
      expect(Number(allowance)).to.be.eq(0)

      const balance3 = await testTokenERC1155.balanceOf.call(redpacket.address, 1)
      console.log(' ========= balance3: ', Number(balance3))
      expect(Number(balance3)).to.be.eq(0)
      expect(Number(balance1) - Number(balance3)).to.be.eq(3)
    })

    // Note: this test spends a long time, on my machine is 10570ms
    it("should refund erc20 successfully when there're 100 red packets and 50 claimers", async () => {
      creationParams.ifrandom = false
      const { redPacketInfo } = await testSuitCreateAndClaimManyRedPackets(50)

      const balance1 = await testTokenERC1155.balanceOf.call(redpacket.address, 1)
      console.log('4444 ========= balance1: ', Number(balance1))
      expect(Number(balance1)).to.be.gt(0)

      await helper.advanceTimeAndBlock(2000)
      await redpacket.refund.sendTransaction(redPacketInfo.id, {
        from: accounts[0],
      })
      const result = await getRefundRedPacketInfo()
      expect(result)
        .to.have.property('token_address')
        .that.to.be.eq(testtoken.address)
      expect(BigNumber(result.remaining_balance).toFixed())
        .to.be.eq(
          BigNumber(creationParams.total_tokens)
            .div(2)
            .toFixed(),
        )
        .and.to.be.eq(BigNumber(5e17).toFixed())

      const balance3 = await testTokenERC1155.balanceOf.call(redpacket.address, 1)
      console.log(' ========= balance3: ', Number(balance3))
      expect(Number(balance3)).to.be.eq(0)
      expect(Number(balance1) - Number(balance3)).to.be.eq(50)

    })
  })

  async function testSuitCreateAndClaimManyRedPackets(claimers = 100) {
    creationParams.total_tokens = BigNumber(1e18).toFixed()
    creationParams.number = 100
    creationParams.token_type = 1
    creationParams.token_addr = testtoken.address

    await testtoken.transfer(accounts[0], creationParams.total_tokens)
    await testtoken.approve.sendTransaction(redpacket.address, creationParams.total_tokens, { from: accounts[0] })

    await createRedPacket()
    const redPacketInfo = await getRedPacketInfo()

    await Promise.all(
      Array.from(Array(claimers).keys()).map(i => {
        const claimParams = createClaimParams(redPacketInfo.id, accounts[i], accounts[i])
        return new Promise(resolve => {
          redpacket.claim
            .sendTransaction(...Object.values(claimParams), {
              from: accounts[i],
            })
            .then(() => resolve())
        })
      }),
    )

    const results = await getClaimRedPacketInfo(claimers - 1)
    return { results, redPacketInfo }
  }

  async function getRedPacketInfo() {
    const logs = await web3.eth.getPastLogs({
      address: redpacket.address,
      topic: [web3.utils.sha3(creation_success_encode)],
    })
    return web3.eth.abi.decodeParameters(creation_success_types, logs[0].data)
  }

  function getRevertMsg(msg) {
    return `VM Exception while processing transaction: reverted with reason string '${msg}'`
  }

  async function createThenGetClaimParams(account) {
    await createRedPacket()
    const redPacketInfo = await getRedPacketInfo()
    return { claimParams: createClaimParams(redPacketInfo.id, account, account), redPacketInfo }
  }

  async function createRedPacket() {
    await redpacket.create_red_packet.sendTransaction(...Object.values(creationParams), {
      from: accounts[0],
      value: creationParams.total_tokens,
    })
  }

  async function getClaimRedPacketInfo(fromBlock = 1) {
    const latestBlock = await web3.eth.getBlockNumber()
    const logs = await web3.eth.getPastLogs({
      address: redpacket.address,
      topic: [web3.utils.sha3(claim_success_encode)],
      fromBlock: latestBlock - fromBlock,
      toBlock: latestBlock,
    })
    return logs.map(log => web3.eth.abi.decodeParameters(claim_success_types, log.data))
  }

  async function getRefundRedPacketInfo() {
    const logs = await web3.eth.getPastLogs({
      address: redpacket.address,
      topic: [web3.utils.sha3(refund_success_encode)],
    })
    return web3.eth.abi.decodeParameters(refund_success_types, logs[0].data)
  }

  function createClaimParams(id, recipient, caller) {
    var signedMsg = web3.eth.accounts.sign(caller, private_key).signature
    return {
      id,
      signedMsg,
      recipient,
    }
  }
})
