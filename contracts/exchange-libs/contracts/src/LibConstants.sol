/*

  Copyright 2018 ZeroEx Intl.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.

*/

pragma solidity ^0.5.5;


// solhint-disable max-line-length, var-name-mixedcase
contract LibConstants {

    // Asset data for ZRX token. Used for fee transfers.
    // @TODO: Hardcode constant when we deploy. Currently
    //        not constant to make testing easier.

    // The proxyId for ZRX_ASSET_DATA is bytes4(keccak256("ERC20Token(address)")) = 0xf47261b0

    // Kovan ZRX address is 0x6ff6c0ff1d68b964901f986d4c9fa3ac68346570.
    // The ABI encoded proxyId and address is 0xf47261b00000000000000000000000006ff6c0ff1d68b964901f986d4c9fa3ac68346570
    // bytes constant public ZRX_ASSET_DATA = "\xf4\x72\x61\xb0\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x6f\xf6\xc0\xff\x1d\x68\xb9\x64\x90\x1f\x98\x6d\x4c\x9f\xa3\xac\x68\x34\x65\x70";

    // Mainnet ZRX address is 0xe41d2489571d322189246dafa5ebde1f4699f498.
    // The ABI encoded proxyId and address is 0xf47261b0000000000000000000000000e41d2489571d322189246dafa5ebde1f4699f498
    // bytes constant public ZRX_ASSET_DATA = "\xf4\x72\x61\xb0\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\xe4\x1d\x24\x89\x57\x1d\x32\x21\x89\x24\x6d\xaf\xa5\xeb\xde\x1f\x46\x99\xf4\x98";

    bytes public ZRX_ASSET_DATA;

    // The chain ID of the network this contract is deployed on.
    uint256 public CHAIN_ID;

    /// @param zrxAssetData Asset data for ZRX token. Used for fee transfers.
    /// @param chainId Chain ID of the network this contract is deployed on.
    constructor (bytes memory zrxAssetData, uint256 chainId)
        public
    {
        ZRX_ASSET_DATA = zrxAssetData;
        CHAIN_ID = chainId;
    }
}
// solhint-enable max-line-length
