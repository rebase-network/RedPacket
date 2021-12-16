import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers, upgrades } from 'hardhat'

type MyMapLikeType = Record<string, string>
const deployedContracts: MyMapLikeType = {
  mainnet: '0x8d285739523FC2Ac8eC9c9C229ee863C8C9bF8C8',
  ropsten: '0x8fF42e93C19E44763FD1cD07b9E04d13bA07AD3f',
  bsc_mainnet: '0xf8968e1Fcf1440Be5Cec7Bb495bcee79753d5E06',
  matic_mainnet: '0xf6Dc042717EF4C097348bE00f4BaE688dcaDD4eA',
  arbitrum: '0x561c5f3a19871ecb1273D6D8eCc276BeEDa5c8b4',
  xdai: '0x561c5f3a19871ecb1273D6D8eCc276BeEDa5c8b4',
  goerli: '0x0a04e23f95E9DB2Fe4C31252548F663fFe3AAe4d',
  fantom: '0xF9F7C1496c21bC0180f4B64daBE0754ebFc8A8c0',
  avalanche: '0x96c7D011cdFD467f551605f0f5Fce279F86F4186',
  celo: '0x96c7D011cdFD467f551605f0f5Fce279F86F4186',
}

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()
  const network: string = hre.hardhatArguments.network ? hre.hardhatArguments.network : 'ropsten'
  const proxyAddress = deployedContracts[network]

  if (false) {
    // deploy, we normally do this only once
    const HappyRedPacketImpl_erc721 = await ethers.getContractFactory('HappyRedPacket_ERC721')
    const HappyRedPacketProxy_erc721 = await upgrades.deployProxy(HappyRedPacketImpl_erc721, [])
    await HappyRedPacketProxy_erc721.deployed()
    console.log('HappyRedPacketProxy_erc721: ' + HappyRedPacketProxy_erc721.address)

    const admin = await upgrades.admin.getInstance();
    const impl_addr = await admin.getProxyImplementation(HappyRedPacketProxy_erc721.address);
    await hre.run('verify:verify', {
        address: impl_addr,
        constructorArguments: [],
    });
  } else {
    // upgrade contract
    const HappyRedPacketImpl = await ethers.getContractFactory('HappyRedPacket_ERC721')
    const instance = await upgrades.upgradeProxy(proxyAddress, HappyRedPacketImpl);

    await instance.deployTransaction.wait();
    const admin = await upgrades.admin.getInstance();
    const impl = await admin.getProxyImplementation(proxyAddress);
    // example: `npx hardhat verify --network rinkeby 0x8974Ce3955eE1306bA89687C558B6fC1E5be777B`
    await hre.run('verify:verify', {
        address: impl,
        constructorArguments: [],
    });
  }
}

func.tags = ['HappyRedPacket_ERC721']

module.exports = func
