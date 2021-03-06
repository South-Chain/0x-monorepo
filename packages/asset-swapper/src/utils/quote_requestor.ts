import { schemas, SchemaValidator } from '@0x/json-schemas';
import { assetDataUtils, SignedOrder } from '@0x/order-utils';
import { ERC20AssetData } from '@0x/types';
import { BigNumber, logUtils } from '@0x/utils';
import Axios, { AxiosResponse } from 'axios';
import * as _ from 'lodash';

import { constants } from '../constants';
import { MarketOperation, RfqtFirmQuoteRequestOpts } from '../types';

/**
 * Request quotes from RFQ-T providers
 */

function getTokenAddressOrThrow(assetData: string): string {
    const decodedAssetData = assetDataUtils.decodeAssetDataOrThrow(assetData);
    if (decodedAssetData.hasOwnProperty('tokenAddress')) {
        // type cast necessary here as decodeAssetDataOrThrow returns
        // an AssetData object, which doesn't necessarily contain a
        // token address.  (it could possibly be a StaticCallAssetData,
        // which lacks an address.)  so we'll just assume it's a token
        // here.  should be safe, with the enclosing guard condition
        // and subsequent error.
        // tslint:disable-next-line:no-unnecessary-type-assertion
        return (decodedAssetData as ERC20AssetData).tokenAddress;
    }
    throw new Error(`Decoded asset data (${JSON.stringify(decodedAssetData)}) does not contain a token address`);
}

export class QuoteRequestor {
    private readonly _rfqtMakerEndpoints: string[];
    private readonly _schemaValidator: SchemaValidator = new SchemaValidator();

    constructor(rfqtMakerEndpoints: string[]) {
        this._rfqtMakerEndpoints = rfqtMakerEndpoints;
    }

    public async requestRfqtFirmQuotesAsync(
        makerAssetData: string,
        takerAssetData: string,
        assetFillAmount: BigNumber,
        marketOperation: MarketOperation,
        takerApiKey: string,
        takerAddress: string,
        options?: Partial<RfqtFirmQuoteRequestOpts>,
    ): Promise<SignedOrder[]> {
        const { makerEndpointMaxResponseTimeMs } = _.merge({}, constants.DEFAULT_RFQT_FIRM_QUOTE_REQUEST_OPTS, options);

        const buyToken = getTokenAddressOrThrow(makerAssetData);
        const sellToken = getTokenAddressOrThrow(takerAssetData);

        // create an array of promises for quote responses, using "undefined"
        // as a placeholder for failed requests.
        const responsesIfDefined: Array<undefined | AxiosResponse<SignedOrder>> = await Promise.all(
            this._rfqtMakerEndpoints.map(async rfqtMakerEndpoint => {
                try {
                    return await Axios.get<SignedOrder>(`${rfqtMakerEndpoint}/quote`, {
                        headers: { '0x-api-key': takerApiKey },
                        params: {
                            sellToken,
                            buyToken,
                            buyAmount: marketOperation === MarketOperation.Buy ? assetFillAmount.toString() : undefined,
                            sellAmount:
                                marketOperation === MarketOperation.Sell ? assetFillAmount.toString() : undefined,
                            takerAddress,
                        },
                        timeout: makerEndpointMaxResponseTimeMs,
                    });
                } catch (err) {
                    logUtils.warn(
                        `Failed to get RFQ-T quote from market maker endpoint ${rfqtMakerEndpoint} for API key ${takerApiKey} for taker address ${takerAddress}`,
                    );
                    logUtils.warn(err);
                    return undefined;
                }
            }),
        );

        const responses = responsesIfDefined.filter(
            (respIfDefd): respIfDefd is AxiosResponse<SignedOrder> => respIfDefd !== undefined,
        );

        const ordersWithStringInts = responses.map(response => response.data); // not yet BigNumber

        const validatedOrdersWithStringInts = ordersWithStringInts.filter(order => {
            const hasValidSchema = this._schemaValidator.isValid(order, schemas.signedOrderSchema);
            if (!hasValidSchema) {
                logUtils.warn(`Invalid RFQ-t order received, filtering out: ${JSON.stringify(order)}`);
                return false;
            }

            const hasExpectedMakerAssetData = order.makerAssetData.toLowerCase() === makerAssetData.toLowerCase();
            const hasExpectedTakerAssetData = order.takerAssetData.toLowerCase() === takerAssetData.toLowerCase();
            if (!hasExpectedMakerAssetData || !hasExpectedTakerAssetData) {
                logUtils.warn(`Unexpected asset data in RFQ-T order, filtering out: ${JSON.stringify(order)}`);
                return false;
            }

            return true;
        });

        const orders: SignedOrder[] = validatedOrdersWithStringInts.map(orderWithStringInts => {
            return {
                ...orderWithStringInts,
                makerAssetAmount: new BigNumber(orderWithStringInts.makerAssetAmount),
                takerAssetAmount: new BigNumber(orderWithStringInts.takerAssetAmount),
                makerFee: new BigNumber(orderWithStringInts.makerFee),
                takerFee: new BigNumber(orderWithStringInts.takerFee),
                expirationTimeSeconds: new BigNumber(orderWithStringInts.expirationTimeSeconds),
                salt: new BigNumber(orderWithStringInts.salt),
            };
        });

        return orders;
    }
}
