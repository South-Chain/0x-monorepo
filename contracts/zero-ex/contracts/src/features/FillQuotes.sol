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

import "../fixins/FixinCommon.sol";
import "../interfaces/IFillQuotes.sol";


/// @dev Owner management features.
contract IFillQuotes is
    IFillQuotes,
    FixinCommon
{
    // solhint-disable const-name-snakecase

    /// @dev Name of this feature.
    string constant public override FEATURE_NAME = "FillQuotes";
    /// @dev Version of this feature.
    uint256 constant public override FEATURE_VERSION = (1 << 64) | (0 << 32) | (0);

    function 
}
