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


interface IFillQuotes {

    /// @dev A market buy quote was successfully filled.
    /// @param taker The taker address.
    /// @param affiliateId The affiliate ID attributed to the fill.
    /// @param makerToken The maker token address.
    /// @param takerToken The taker token address.
    /// @param makerTokenAmountBought The amount of maker asset bought.
    /// @param takerTokenAmountSold The amount of taker asset sold.
    event BuyQuoteFilled(
        address indexed taker,
        address indexed affiliateId,
        address makerToken,
        address takerToken,
        uint256 makerTokenAmountBought,
        uint256 takerTokenAmountSold,
    );

    /// @dev A market sell quote was successfully filled.
    /// @param taker The taker address.
    /// @param affiliateId The affiliate ID attributed to the fill.
    /// @param makerToken The maker token address.
    /// @param takerToken The taker token address.
    /// @param makerTokenAmountBought The amount of maker asset bought.
    /// @param takerTokenAmountSold The amount of taker asset sold.
    event SellQuoteFilled(
        address indexed taker,
        address indexed affiliateId,
        address makerToken,
        address takerToken,
        uint256 makerTokenAmountBought,
        uint256 takerTokenAmountSold
    );

    /// @dev Fill a market sell quote, unwrap WETH, and pay fees to recipients.
    function fillSellQuoteWithEth(
        address affiliateId,
        IERC20 makerToken,
        IERC20 takerToken,
        uint256 takerTokenSellAmount,
        uint256 minMakerTokenBuyAmount,
        Order[] calldata orders,
        QuoteFee[] calldata takerTokenFees,
        QuoteFee[] calldata makerTokenFees
    )
        external
        payable
        noReentrancy
        returns (uint256 makerTokenAmountBought, uint256 takerTokenAmountSold)
    {
        // Acquire taker tokens;
        if (address(takerToken) == address(WETH)) {
            WETH.deposit{ value: takerTokenSellAmount }();
        } else {
            _pullTakerTokens(takerToken, takerTokenSellAmount);
        }

        // Pay taker token fees.
        _payQuoteFees(takerTokenSellAmount, takerTokenFees); // <- Can pay for protocol fees.

        // Fill the quote.
        (makerTokenAmountBought, takerTokenAmountSold) =
            this.fillSellQuoteFrom
            { value: address(this).balance }
            (msg.sender, orders, takerTokenSellAmount);
        require(makerTokenAmountBought >= minMakerTokenBuyAmount);

        // Pay maker token fees.
        _payQuoteFees(makerTokenAmountBought, makerTokenFees);

        // Convert WETH -> ETH
        _unwrapWEth();
        // Send ETH balance to the taker.
        msg.sender.transfer(address(this).balance);
        if (address(makerToken) == address(WETH)) {
            // Send maker tokens to the taker.
            makerToken.transfer(msg.sender, makerToken.balanceOf(address(this)));
        }

        emit SellQuoteFilled(
            msg.sender,
            affiliateId,
            makerToken,
            takerToken,
            makerTokenAmountBought,
            takerTokenAmountSold
        );
    }

    struct QuoteFee {
        // In PPM (e.g., 1000000 = 100%)
        uint256 rate;
        // Fee recipient.
        // If a contract, must implement IQuoteFeeRecipient interface.
        address recipient;
    }

    function _payQuoteFees(IERC20 token, QuoteFee[] memory fees) {
        for (fee of fees) {
            if (_isContractAt(fee.recipient)) {
                IQuoteFeeRecipient(fee.recipient).onQuoteFeeReceived(token, amount);
            }
        }
    }
}
