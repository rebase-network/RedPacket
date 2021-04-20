pragma solidity 0.6.2;
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";


contract HappyRedPacket {

    struct RedPacket {
        Packed packed;
        mapping(address => uint256) claimed_list;
    }

    struct Packed {
        uint256 packed1;            // exp(48) total_tokens(80) hash(64) id(64) BIG ENDIAN
        uint256 packed2;            // ifrandom(1) token_type(8) total_number(8) claimed(8) creator(64) token_addr(160)
    }

    event CreationSuccess(
        uint total,
        bytes32 id,
        string name,
        string message,
        address creator,
        uint creation_time,
        address token_address
    );

    event ClaimSuccess(
        bytes32 id,
        address claimer,
        uint claimed_value,
        address token_address
    );

    event RefundSuccess(
        bytes32 id,
        address token_address,
        uint remaining_balance
    );

    using SafeERC20 for IERC20;
    uint32 nonce;
    address public contract_creator;
    mapping(bytes32 => RedPacket) redpacket_by_id;
    string constant private magic = "Former NBA Commissioner David St"; // 32 bytes
    bytes32 private seed;
    uint256 constant MASK = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;

    constructor() public {
        contract_creator = msg.sender;
        seed = keccak256(abi.encodePacked(magic, block.timestamp, contract_creator));
    }

    // Inits a red packet instance
    // _token_type: 0 - ETH 1 - ERC20
    function create_red_packet (bytes32 _hash, uint _number, bool _ifrandom, uint _duration, 
                                bytes32 _seed, string memory _message, string memory _name,
                                uint _token_type, address _token_addr, uint _total_tokens) 
    public payable {
        nonce ++;
        require(_total_tokens >= _number, "#tokens > #packets");
        require(_number > 0, "At least 1 recipient");
        require(_number < 256, "At most 255 recipients");
        require(_token_type == 0 || _token_type == 1, "Unrecognizable token type");

        if (_token_type == 0)
            require(msg.value >= _total_tokens, "No enough ETH");
        else if (_token_type == 1) {
            require(IERC20(_token_addr).allowance(msg.sender, address(this)) >= _total_tokens, "No enough allowance");
            IERC20(_token_addr).safeTransferFrom(msg.sender, address(this), _total_tokens);
        }

        bytes32 _id = keccak256(abi.encodePacked(msg.sender, block.timestamp, nonce, seed, _seed));
        uint _random_type = _ifrandom ? 1 : 0;
        RedPacket storage redp = redpacket_by_id[_id];
        redp.packed.packed1 = wrap1(_hash, _total_tokens, _duration);
        redp.packed.packed2 = wrap2(_token_addr, _number, _token_type, _random_type);
        emit CreationSuccess(_total_tokens, _id, _name, _message, msg.sender, block.timestamp, _token_addr);
    }

    // It takes the unhashed password and a hashed random seed generated from the user
    function claim(bytes32 id, string memory password, address _recipient, bytes32 validation) 
    public returns (uint claimed) {

        RedPacket storage rp = redpacket_by_id[id];
        Packed memory packed = rp.packed;
        address payable recipient = address(uint160(_recipient));
        // Unsuccessful
        require (unbox(packed.packed1, 224, 32) > block.timestamp, "Expired");
        uint total_number = unbox(packed.packed2, 239, 15);
        uint claimed_number = unbox(packed.packed2, 224, 15);
        require (claimed_number < total_number, "Out of stock");
        require (uint256(keccak256(bytes(password))) >> 128 == unbox(packed.packed1, 0, 128), "Wrong password");
        require (validation == keccak256(abi.encodePacked(msg.sender)), "Validation failed");

        uint256 claimed_tokens;
        uint256 token_type = unbox(packed.packed2, 254, 1);
        uint256 ifrandom = unbox(packed.packed2, 255, 1);
        uint256 remaining_tokens = unbox(packed.packed1, 128, 96);
        if (ifrandom == 1) {
            if (total_number - claimed_number == 1)
                claimed_tokens = remaining_tokens;
            else 
                claimed_tokens = random(seed, nonce) % SafeMath.div(SafeMath.mul(remaining_tokens, 2), total_number - claimed_number);
            if (claimed_tokens == 0) 
                claimed_tokens = 1;
        } else {
            if (total_number - claimed_number == 1) 
                claimed_tokens = remaining_tokens;
            else
                claimed_tokens = SafeMath.div(remaining_tokens, (total_number - claimed_number));
        }
        rp.packed.packed1 = rewriteBox(packed.packed1, 128, 96, remaining_tokens - claimed_tokens);

        // Penalize greedy attackers by placing duplication check at the very last
        require(rp.claimed_list[msg.sender] == 0, "Already claimed");

        rp.claimed_list[msg.sender] = claimed_tokens;
        rp.packed.packed2 = rewriteBox(packed.packed2, 224, 15, claimed_number + 1);

        // Transfer the red packet after state changing
        if (token_type == 0)
            recipient.transfer(claimed_tokens);
        else if (token_type == 1)
            transfer_token(address(unbox(packed.packed2, 0, 160)), address(this),
                            recipient, claimed_tokens);
        // Claim success event
        emit ClaimSuccess(id, recipient, claimed_tokens, address(unbox(packed.packed2, 0, 160)));
        return claimed_tokens;
    }

    // Returns 1. remaining value 2. total number of red packets 3. claimed number of red packets
    function check_availability(bytes32 id) external view returns ( address token_address, uint balance, uint total, 
                                                                    uint claimed, bool expired, uint256 claimed_amount) {
        RedPacket storage rp = redpacket_by_id[id];
        Packed memory packed = rp.packed;
        return (
            address(unbox(packed.packed2, 0, 160)), 
            unbox(packed.packed1, 128, 96), 
            unbox(packed.packed2, 239, 15), 
            unbox(packed.packed2, 224, 15), 
            block.timestamp > unbox(packed.packed1, 224, 32), 
            rp.claimed_list[msg.sender]
        );
    }

    function refund(bytes32 id) public {
        RedPacket storage rp = redpacket_by_id[id];
        Packed memory packed = rp.packed;
        require(packed.packed1 != 0 && packed.packed2 != 0, "Already Refunded");
        require(uint256(keccak256(abi.encodePacked(msg.sender)) >> 192) == unbox(packed.packed2, 160, 64), "Creator Only");
        require(unbox(packed.packed1, 224, 32) <= block.timestamp, "Not expired yet");

        uint256 remaining_tokens = unbox(packed.packed1, 128, 96);
        require(remaining_tokens != 0, "None left in the red packet");

        uint256 token_type = unbox(packed.packed2, 254, 1);
        address token_address = address(unbox(packed.packed2, 0, 160));

        if (token_type == 0) {
            msg.sender.transfer(remaining_tokens);
        }
        else if (token_type == 1) {
            IERC20(token_address).approve(msg.sender, remaining_tokens);
            transfer_token(token_address, address(this),
                            msg.sender, remaining_tokens);
        }

        emit RefundSuccess(id, token_address, remaining_tokens);
        // Gas Refund
        rp.packed.packed1 = 0;
        rp.packed.packed2 = 0;
    }

//------------------------------------------------------------------
    /**
     * position      position in a memory block
     * size          data size
     * data          data
     * box() inserts the data in a 256bit word with the given position and returns it
     * data is checked by validRange() to make sure it is not over size 
    **/

    function box (uint16 position, uint16 size, uint256 data) internal pure returns (uint256 boxed) {
        require(validRange(size, data), "Value out of range BOX");
        assembly {
            // data << position
            boxed := shl(position, data)
        }
    }

    /**
     * position      position in a memory block
     * size          data size
     * base          base data
     * unbox() extracts the data out of a 256bit word with the given position and returns it
     * base is checked by validRange() to make sure it is not over size 
    **/

    function unbox (uint256 base, uint16 position, uint16 size) internal pure returns (uint256 unboxed) {
        require(validRange(256, base), "Value out of range UNBOX");
        assembly {
            // (((1 << size) - 1) & base >> position)
            unboxed := and(sub(shl(size, 1), 1), shr(position, base))

        }
    }

    /**
     * size          data size
     * data          data
     * validRange()  checks if the given data is over the specified data size
    **/

    function validRange (uint16 size, uint256 data) internal pure returns(bool ifValid) { 
        assembly {
            // 2^size > data or size ==256
            ifValid := or(eq(size, 256), gt(shl(size, 1), data))
        }
    }

    /**
     * _box          32byte data to be modified
     * position      position in a memory block
     * size          data size
     * data          data to be inserted
     * rewriteBox() updates a 32byte word with a data at the given position with the specified size
    **/

    function rewriteBox (uint256 _box, uint16 position, uint16 size, uint256 data) 
                        internal pure returns (uint256 boxed) {
        assembly {
            // mask = ~((1 << size - 1) << position)
            // _box = (mask & _box) | ()data << position)
            boxed := or( and(_box, not(shl(position, sub(shl(size, 1), 1)))), shl(position, data))
        }
    }

    // Check the balance of the given token
    function transfer_token(address token_address, address sender_address,
                            address recipient_address, uint amount) internal{
        require(IERC20(token_address).balanceOf(sender_address) >= amount, "Balance too low");
        IERC20(token_address).safeTransfer(recipient_address, amount);
    }
    
    // A boring wrapper
    function random(bytes32 _seed, uint32 nonce_rand) internal view returns (uint rand) {
        return uint(keccak256(abi.encodePacked(nonce_rand, msg.sender, _seed, block.timestamp))) + 1 ;
    }
    
    function wrap1 (bytes32 _hash, uint _total_tokens, uint _duration) internal view returns (uint256 packed1) {
        uint256 _packed1 = 0;
        _packed1 |= box(0, 128, uint256(_hash) >> 128); // hash = 128 bits (NEED TO CONFIRM THIS)
        _packed1 |= box(128, 96, _total_tokens);        // total tokens = 80 bits = ~8 * 10^10 18 decimals
        _packed1 |= box(224, 32, (block.timestamp + _duration));    // expiration_time = 32 bits (until 2106)
        return _packed1;
    }

    function wrap2 (address _token_addr, uint _number, uint _token_type, uint _ifrandom) internal view returns (uint256 packed2) {
        uint256 _packed2 = 0;
        _packed2 |= box(0, 160, uint256(_token_addr));    // token_address = 160 bits
        _packed2 |= box(160, 64, (uint256(keccak256(abi.encodePacked(msg.sender))) >> 192));  // creator.hash = 64 bit
        _packed2 |= box(224, 15, 0);                   // claimed_number = 14 bits 16384
        _packed2 |= box(239, 15, _number);               // total_number = 14 bits 16384
        _packed2 |= box(254, 1, _token_type);             // token_type = 1 bit 2
        _packed2 |= box(255, 1, _ifrandom);                 // ifrandom = 1 bit 2
        return _packed2;
    }
}
