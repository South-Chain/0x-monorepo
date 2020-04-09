/*

  Copyright 2020 ZeroEx Intl.

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

pragma solidity ^0.6.5;
pragma experimental ABIEncoderV2;

import "@0x/contracts-utils/contracts/src/v06/errors/LibRichErrorsV06.sol";
import "@0x/contracts-utils/contracts/src/v06/AuthorizableV06.sol";
import "./ITransferProxy.sol";

/// @dev A standalone contract that acts as the target for allowances
///      and transfers assets on behalf of a spender.
contract TransferProxy is
    ITransferProxy,
    AuthorizableV06
{
    /// @dev Execute an arbitrary call, forwarding any ether attached and
    ///      refunding any remaining ether.
    /// @param target The call target.
    /// @param callData The call data.
    /// @return resultData The data returned by the call.
    function execute(address payable target, bytes calldata callData)
        external
        payable
        onlyAuthorized
        returns (bytes memory resultData)
    {
        bool success;
        (success, resultData) = target.call{value: msg.value}(callData);

        // Refund any outstanding balance.
        uint256 balance = address(this).balance;
        if (balance != 0) {
            msg.sender.transfer(balance);
        }

        if (!success) {
            assembly { revert(add(resultData, 32), mload(resultData)) }
        }
    }
}
