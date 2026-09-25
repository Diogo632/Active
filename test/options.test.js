import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, normalizeOptions } from '../public/js/options.js';

test('lista curta após pergunta vira opções (formato do Active AI)', () => {
  const text = 'Para montar o JSON da ocorrência, como você vai identificar o documento?\n\n- Chave eletrônica\n- NF ou pedido\n- CT-e\n- Outro identificador';
  const { text: body, options } = parseOptions(text);
  assert.deepEqual(options, ['Chave eletrônica', 'NF ou pedido', 'CT-e', 'Outro identificador']);
  assert.equal(body, 'Para montar o JSON da ocorrência, como você vai identificar o documento?');
});

test('passo a passo comum não vira opções', () => {
  const text = 'Siga os passos:\n\n1. Abra a tela de cadastro.\n2. Clique em salvar.';
  assert.deepEqual(parseOptions(text).options, []);
  const semPergunta = 'Os tipos são:\n- CT-e\n- MDF-e';
  assert.deepEqual(parseOptions(semPergunta).options, []);
});

test('marcações explícitas [[...]] e <opcoes>', () => {
  assert.deepEqual(parseOptions('Escolha:\n[[Sim | Não]]').options, ['Sim', 'Não']);
  const r = parseOptions('Qual sistema?<opcoes>ActiveTrans|OnSupply</opcoes>');
  assert.deepEqual(r.options, ['ActiveTrans', 'OnSupply']);
  assert.equal(r.text, 'Qual sistema?');
});

test('normalizeOptions aceita objetos e remove duplicados', () => {
  assert.deepEqual(normalizeOptions(['A', { label: 'B' }, { text: 'a' }]), ['A', 'B']);
});

test('pergunta no meio do parágrafo, como no Active AI', () => {
  const text = 'Você vai identificar o documento por **chave eletrônica, NF/pedido, CT-e ou outro identificador**? Essa definição muda o objeto `Documento`.\n\n- Chave eletrônica\n- NF ou pedido\n- CT-e\n- Outro identificador';
  assert.deepEqual(parseOptions(text).options, ['Chave eletrônica', 'NF ou pedido', 'CT-e', 'Outro identificador']);
});
