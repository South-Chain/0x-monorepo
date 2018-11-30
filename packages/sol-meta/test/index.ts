import * as chai from 'chai';
import * as fs from 'fs';
import * as glob from 'glob';
import * as _ from 'lodash';
import 'mocha';
import * as path from 'path';
import * as S from 'solidity-parser-antlr';

import { parse } from '../src/parser';
import { readSources, SourceInfo, SourceCollection } from '../src/source_reader';
import { unparse } from '../src/unparser';
import { compile } from '../src/solc_wrapper';
import { mockContract } from '../src/contract_mocker';

const expect = chai.expect;

const findContracts = (searchPath: string) =>
    glob.sync(searchPath).map(file => ({
        name: path.basename(file, '.sol'),
        source: fs.readFileSync(file, 'utf8'),
    }));

const contracts = findContracts('../contracts/contracts/**/*.sol');

describe('Parser', () => {
    it('should have test contracts', () => {
        expect(contracts).to.have.lengthOf.above(10);
    });

    contracts.forEach(({ name, source }) =>
        it(`should parse ${name}`, () => {
            parse(source);
        }),
    );
});

describe('Unparser', () => {
    contracts.forEach(({ name, source }) =>
        it(`should unparse ${name}`, () => {
            const ast = parse(source);
            const src = unparse(ast);
            const ast2 = parse(src);
            // Ideally, we would test the following:
            //     expect(ast2).to.deep.equal(ast);
            // But this fails on on expressiong like `2 * 3 + 1` which get rewritten
            // to `((2 * 2) + 1)`. This prevents the ASTs from being identicall in
            // syntax, even though they should be identical in meaning.
        }),
    );
});

describe('Mocker', () => {
    const sourcePath = '../contracts/contracts/protocol/Exchange/';
    const toMock = ['Exchange', 'MixinExchangeCore', 'MixinSignatureValidator', 'MixinWrapperFunctions'];
    const path = (name: string) => `${sourcePath}/${name}.sol`;
    let sources: SourceCollection;
    let mocks: { [name: string]: S.SourceUnit } = {};

    it('should read sources', async () => {
        sources = await readSources(_.map(toMock, path));
        _.map(toMock, name => expect(_.keys(sources).some(absPath => absPath.endsWith(`${name}.sol`))));
    });
    _.map(toMock, name =>
        it(`should generate mocks for ${name}`, () => {
            mocks[name] = mockContract(
                sources,
                _.keys(sources).find(absPath => absPath.endsWith(`${name}.sol`)) || '',
                name,
                {
                    constructors: {
                        LibConstants: ['"ZRXASSETSTRING"'],
                        Exchange: ['"ZRXASSETSTRING"'],
                    },
                    scripted: {},
                },
            );
        }),
    );
    // Note(recmo): These tests are slow
    describe.skip('Compiling', () =>
        _.map(toMock, name =>
            it(`should compile mock for ${name}`, async () => {
                await compile(sources, mocks[name]);
            }).timeout(30000),
        ));
});
