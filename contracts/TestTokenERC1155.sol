//SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract TestTokenERC1155 is ERC1155 {
    constructor(uint initialSupply) ERC1155("ipfs://") {
        _mint(msg.sender, 1, initialSupply, "");
    }
}
