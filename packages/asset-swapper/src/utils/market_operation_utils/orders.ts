import { ContractAddresses } from '@0x/contract-addresses';
import { assetDataUtils, ERC20AssetData, generatePseudoRandomSalt, orderCalculationUtils } from '@0x/order-utils';
import { ERC20BridgeAssetData, SignedOrder } from '@0x/types';
import { AbiEncoder, BigNumber } from '@0x/utils';

import { MarketOperation, SignedOrderWithFillableAmounts } from '../../types';

import {
    DEFAULT_CURVE_OPTS,
    ERC20_PROXY_ID,
    NULL_ADDRESS,
    NULL_BYTES,
    ONE_HOUR_IN_SECONDS,
    ONE_SECOND_MS,
    WALLET_SIGNATURE,
    ZERO_AMOUNT,
} from './constants';
import { collapsePath } from './fills';
import {
    AggregationError,
    CollapsedFill,
    ERC20BridgeSource,
    Fill,
    NativeCollapsedFill,
    OptimizedMarketOrder,
    OrderDomain,
} from './types';

// tslint:disable completed-docs no-unnecessary-type-assertion

interface DexForwaderBridgeData {
    inputToken: string;
    calls: Array<{
        target: string;
        inputTokenAmount: BigNumber;
        outputTokenAmount: BigNumber;
        bridgeData: string;
    }>;
}

const dexForwarderBridgeDataEncoder = AbiEncoder.create([
    { name: 'inputToken', type: 'address' },
    {
        name: 'calls',
        type: 'tuple[]',
        components: [
            { name: 'target', type: 'address' },
            { name: 'inputTokenAmount', type: 'uint256' },
            { name: 'outputTokenAmount', type: 'uint256' },
            { name: 'bridgeData', type: 'bytes' },
        ],
    },
]);

export function createDummyOrderForSampler(
    makerAssetData: string,
    takerAssetData: string,
    makerAddress: string,
): SignedOrder {
    return {
        makerAddress,
        takerAddress: NULL_ADDRESS,
        senderAddress: NULL_ADDRESS,
        feeRecipientAddress: NULL_ADDRESS,
        salt: ZERO_AMOUNT,
        expirationTimeSeconds: ZERO_AMOUNT,
        makerAssetData,
        takerAssetData,
        makerFeeAssetData: NULL_BYTES,
        takerFeeAssetData: NULL_BYTES,
        makerFee: ZERO_AMOUNT,
        takerFee: ZERO_AMOUNT,
        makerAssetAmount: ZERO_AMOUNT,
        takerAssetAmount: ZERO_AMOUNT,
        signature: NULL_BYTES,
        chainId: 1,
        exchangeAddress: NULL_ADDRESS,
    };
}

export function getNativeOrderTokens(order: SignedOrder): [string, string] {
    const assets = [order.makerAssetData, order.takerAssetData].map(a => assetDataUtils.decodeAssetDataOrThrow(a)) as [
        ERC20AssetData,
        ERC20AssetData
    ];
    if (assets.some(a => a.assetProxyId !== ERC20_PROXY_ID)) {
        throw new Error(AggregationError.NotERC20AssetData);
    }
    return assets.map(a => a.tokenAddress.toLowerCase()) as [string, string];
}

export function convertNativeOrderToFullyFillableOptimizedOrders(order: SignedOrder): OptimizedMarketOrder {
    return {
        ...order,
        fillableMakerAssetAmount: order.makerAssetAmount,
        fillableTakerAssetAmount: order.takerAssetAmount,
        fillableTakerFeeAmount: order.takerFee,
        fills: [],
    };
}

/**
 * Augments native orders with fillable amounts and filters out unfillable orders.
 */
export function createSignedOrdersWithFillableAmounts(
    side: MarketOperation,
    orders: SignedOrder[],
    fillableAmounts: BigNumber[],
): SignedOrderWithFillableAmounts[] {
    return orders
        .map((order: SignedOrder, i: number) => {
            const fillableAmount = fillableAmounts[i];
            const fillableMakerAssetAmount =
                side === MarketOperation.Buy
                    ? fillableAmount
                    : orderCalculationUtils.getMakerFillAmount(order, fillableAmount);
            const fillableTakerAssetAmount =
                side === MarketOperation.Sell
                    ? fillableAmount
                    : orderCalculationUtils.getTakerFillAmount(order, fillableAmount);
            const fillableTakerFeeAmount = orderCalculationUtils.getTakerFeeAmount(order, fillableTakerAssetAmount);
            return {
                ...order,
                fillableMakerAssetAmount,
                fillableTakerAssetAmount,
                fillableTakerFeeAmount,
            };
        })
        .filter(order => {
            return !order.fillableMakerAssetAmount.isZero() && !order.fillableTakerAssetAmount.isZero();
        });
}

export interface CreateOrderFromPathOpts {
    side: MarketOperation;
    inputToken: string;
    outputToken: string;
    orderDomain: OrderDomain;
    contractAddresses: ContractAddresses;
    bridgeSlippage: number;
    shouldBatchBridgeOrders: boolean;
    liquidityProviderAddress?: string;
}

// Convert sell fills into orders.
export function createOrdersFromPath(path: Fill[], opts: CreateOrderFromPathOpts): OptimizedMarketOrder[] {
    const collapsedPath = collapsePath(path);
    const orders: OptimizedMarketOrder[] = [];
    for (let i = 0; i < collapsedPath.length; ) {
        if (collapsedPath[i].source === ERC20BridgeSource.Native) {
            orders.push(createNativeOrder(collapsedPath[i]));
            ++i;
            continue;
        }
        // Liquidity Provider must be called by ERC20BridgeProxy
        if (collapsedPath[i].source === ERC20BridgeSource.LiquidityProvider) {
            orders.push(createBridgeOrder(collapsedPath[i], opts));
            ++i;
            continue;
        }
        // If there are contiguous bridge orders, we can batch them together.
        const contiguousBridgeFills = [collapsedPath[i]];
        for (let j = i + 1; j < collapsedPath.length; ++j) {
            if (
                collapsedPath[j].source === ERC20BridgeSource.Native ||
                collapsedPath[j].source === ERC20BridgeSource.LiquidityProvider
            ) {
                break;
            }
            contiguousBridgeFills.push(collapsedPath[j]);
        }
        // Always use DexForwarderBridge unless configured not to
        if (!opts.shouldBatchBridgeOrders) {
            orders.push(createBridgeOrder(contiguousBridgeFills[0], opts));
            i += 1;
        } else {
            orders.push(createBatchedBridgeOrder(contiguousBridgeFills, opts));
            i += contiguousBridgeFills.length;
        }
    }
    return orders;
}

function getBridgeAddressFromSource(source: ERC20BridgeSource, opts: CreateOrderFromPathOpts): string {
    switch (source) {
        case ERC20BridgeSource.Eth2Dai:
            return opts.contractAddresses.eth2DaiBridge;
        case ERC20BridgeSource.Kyber:
            return opts.contractAddresses.kyberBridge;
        case ERC20BridgeSource.Uniswap:
            return opts.contractAddresses.uniswapBridge;
        case ERC20BridgeSource.CurveUsdcDai:
        case ERC20BridgeSource.CurveUsdcDaiUsdt:
        case ERC20BridgeSource.CurveUsdcDaiUsdtTusd:
        case ERC20BridgeSource.CurveUsdcDaiUsdtBusd:
            return opts.contractAddresses.curveBridge;
        case ERC20BridgeSource.LiquidityProvider:
            if (opts.liquidityProviderAddress === undefined) {
                throw new Error('Cannot create a LiquidityProvider order without a LiquidityProvider pool address.');
            }
            return opts.liquidityProviderAddress;
        default:
            break;
    }
    throw new Error(AggregationError.NoBridgeForSource);
}

function createBridgeOrder(fill: CollapsedFill, opts: CreateOrderFromPathOpts): OptimizedMarketOrder {
    const [makerToken, takerToken] = getMakerTakerTokens(opts);
    const bridgeAddress = getBridgeAddressFromSource(fill.source, opts);

    let makerAssetData;
    if (Object.keys(DEFAULT_CURVE_OPTS).includes(fill.source)) {
        const { curveAddress, tokens, version } = DEFAULT_CURVE_OPTS[fill.source];
        const fromTokenIdx = tokens.indexOf(takerToken);
        const toTokenIdx = tokens.indexOf(makerToken);
        makerAssetData = assetDataUtils.encodeERC20BridgeAssetData(
            makerToken,
            bridgeAddress,
            createCurveBridgeData(curveAddress, fromTokenIdx, toTokenIdx, version),
        );
    } else {
        makerAssetData = assetDataUtils.encodeERC20BridgeAssetData(
            makerToken,
            bridgeAddress,
            createBridgeData(takerToken),
        );
    }
    const [slippedMakerAssetAmount, slippedTakerAssetAmount] = getSlippedBridgeAssetAmounts(fill, opts);
    return {
        fills: [fill],
        makerAssetData,
        takerAssetData: assetDataUtils.encodeERC20AssetData(takerToken),
        makerAddress: bridgeAddress,
        makerAssetAmount: slippedMakerAssetAmount,
        takerAssetAmount: slippedTakerAssetAmount,
        fillableMakerAssetAmount: slippedMakerAssetAmount,
        fillableTakerAssetAmount: slippedTakerAssetAmount,
        ...createCommonBridgeOrderFields(opts),
    };
}

function createBatchedBridgeOrder(fills: CollapsedFill[], opts: CreateOrderFromPathOpts): OptimizedMarketOrder {
    const [makerToken, takerToken] = getMakerTakerTokens(opts);
    let totalMakerAssetAmount = ZERO_AMOUNT;
    let totalTakerAssetAmount = ZERO_AMOUNT;
    const batchedBridgeData: DexForwaderBridgeData = {
        inputToken: takerToken,
        calls: [],
    };
    for (const fill of fills) {
        const bridgeOrder = createBridgeOrder(fill, opts);
        totalMakerAssetAmount = totalMakerAssetAmount.plus(bridgeOrder.makerAssetAmount);
        totalTakerAssetAmount = totalTakerAssetAmount.plus(bridgeOrder.takerAssetAmount);
        const { bridgeAddress, bridgeData: orderBridgeData } = assetDataUtils.decodeAssetDataOrThrow(
            bridgeOrder.makerAssetData,
        ) as ERC20BridgeAssetData;
        batchedBridgeData.calls.push({
            target: bridgeAddress,
            bridgeData: orderBridgeData,
            inputTokenAmount: bridgeOrder.takerAssetAmount,
            outputTokenAmount: bridgeOrder.makerAssetAmount,
        });
    }
    const batchedBridgeAddress = opts.contractAddresses.dexForwarderBridge;
    const batchedMakerAssetData = assetDataUtils.encodeERC20BridgeAssetData(
        makerToken,
        batchedBridgeAddress,
        dexForwarderBridgeDataEncoder.encode(batchedBridgeData),
    );
    return {
        fills,
        makerAssetData: batchedMakerAssetData,
        takerAssetData: assetDataUtils.encodeERC20AssetData(takerToken),
        makerAddress: batchedBridgeAddress,
        makerAssetAmount: totalMakerAssetAmount,
        takerAssetAmount: totalTakerAssetAmount,
        fillableMakerAssetAmount: totalMakerAssetAmount,
        fillableTakerAssetAmount: totalTakerAssetAmount,
        ...createCommonBridgeOrderFields(opts),
    };
}

function getMakerTakerTokens(opts: CreateOrderFromPathOpts): [string, string] {
    const makerToken = opts.side === MarketOperation.Sell ? opts.outputToken : opts.inputToken;
    const takerToken = opts.side === MarketOperation.Sell ? opts.inputToken : opts.outputToken;
    return [makerToken, takerToken];
}

function createBridgeData(tokenAddress: string): string {
    const encoder = AbiEncoder.create([{ name: 'tokenAddress', type: 'address' }]);
    return encoder.encode({ tokenAddress });
}

function createCurveBridgeData(
    curveAddress: string,
    fromTokenIdx: number,
    toTokenIdx: number,
    version: number,
): string {
    const curveBridgeDataEncoder = AbiEncoder.create([
        { name: 'curveAddress', type: 'address' },
        { name: 'fromTokenIdx', type: 'int128' },
        { name: 'toTokenIdx', type: 'int128' },
        { name: 'version', type: 'int128' },
    ]);
    return curveBridgeDataEncoder.encode([curveAddress, fromTokenIdx, toTokenIdx, version]);
}

function getSlippedBridgeAssetAmounts(fill: CollapsedFill, opts: CreateOrderFromPathOpts): [BigNumber, BigNumber] {
    return [
        // Maker asset amount.
        opts.side === MarketOperation.Sell
            ? fill.output.times(1 - opts.bridgeSlippage).integerValue(BigNumber.ROUND_DOWN)
            : fill.input,
        // Taker asset amount.
        opts.side === MarketOperation.Sell
            ? fill.input
            : fill.output.times(opts.bridgeSlippage + 1).integerValue(BigNumber.ROUND_UP),
    ];
}

type CommonBridgeOrderFields = Pick<
    OptimizedMarketOrder,
    Exclude<
        keyof OptimizedMarketOrder,
        | 'fills'
        | 'makerAddress'
        | 'makerAssetData'
        | 'takerAssetData'
        | 'makerAssetAmount'
        | 'takerAssetAmount'
        | 'fillableMakerAssetAmount'
        | 'fillableTakerAssetAmount'
    >
>;

function createCommonBridgeOrderFields(opts: CreateOrderFromPathOpts): CommonBridgeOrderFields {
    return {
        takerAddress: NULL_ADDRESS,
        senderAddress: NULL_ADDRESS,
        feeRecipientAddress: NULL_ADDRESS,
        salt: generatePseudoRandomSalt(),
        expirationTimeSeconds: new BigNumber(Math.floor(Date.now() / ONE_SECOND_MS) + ONE_HOUR_IN_SECONDS),
        makerFeeAssetData: NULL_BYTES,
        takerFeeAssetData: NULL_BYTES,
        makerFee: ZERO_AMOUNT,
        takerFee: ZERO_AMOUNT,
        fillableTakerFeeAmount: ZERO_AMOUNT,
        signature: WALLET_SIGNATURE,
        ...opts.orderDomain,
    };
}

function createNativeOrder(fill: CollapsedFill): OptimizedMarketOrder {
    return {
        fills: [fill],
        ...(fill as NativeCollapsedFill).nativeOrder,
    };
}
