// Sağlık Asistanı n8n workflow tanımı.
// `npm run build:workflow` bu tanımdan n8n/workflows/health-assistant.json üretir.
//
// Tüm iş akışı ve if/else kararları burada, görünür node'lar olarak tanımlıdır:
//   IF "Request valid?"      -> girdi doğrulama sonucu
//   Switch "Route message"   -> tekrar istek / konuşma yok / ACİL / Selamla / Semptom Analizi
//   IF "AI output valid?"    -> model çıktısı şema ve güvenlik kontrolü
// Code node'ları yalnızca saf veri dönüşümü yapar (n8n/src/code).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowBuilder, bundleCodeModule, loadJsonSchema, stableUuid } from '../../scripts/lib/n8n-builder.mjs';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const codeFile = (name) => path.join(SRC_DIR, 'code', name);
const prompt = (name) => readFileSync(path.join(SRC_DIR, 'prompts', name), 'utf8').trim();
const schema = (name) => JSON.stringify(loadJsonSchema(path.join(SRC_DIR, 'schemas', name)), null, 2);

export const API_BASE_PATH = 'health-assistant';

const NODE_TYPES = {
  webhook: ['n8n-nodes-base.webhook', 2.1],
  code: ['n8n-nodes-base.code', 2],
  if: ['n8n-nodes-base.if', 2.3],
  switch: ['n8n-nodes-base.switch', 3.4],
  postgres: ['n8n-nodes-base.postgres', 2.6],
  respond: ['n8n-nodes-base.respondToWebhook', 1.5],
  sticky: ['n8n-nodes-base.stickyNote', 1],
  chain: ['@n8n/n8n-nodes-langchain.chainLlm', 1.9],
  gemini: ['@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 1.2],
  parser: ['@n8n/n8n-nodes-langchain.outputParserStructured', 1.3],
};

const booleanCondition = (name, expression, expected) => ({
  options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
  conditions: [
    {
      id: stableUuid(`condition:${name}`),
      leftValue: `={{ ${expression} }}`,
      rightValue: '',
      operator: { type: 'boolean', operation: expected ? 'true' : 'false', singleValue: true },
    },
  ],
  combinator: 'and',
});

/**
 * @param {object} config
 * @param {{id?: string, name: string}} config.geminiCredential
 * @param {{id?: string, name: string}} config.postgresCredential
 * @param {string} config.model Gemini model adı (ör. models/gemini-3.8-flash)
 * @param {string} [config.fallbackModel] Ana model hata verirse kullanılacak Gemini modeli
 * @param {string} config.allowedOrigins CORS için virgülle ayrılmış origin listesi
 * @param {boolean} config.saveSuccessfulExecutions Geliştirmede true; varsayılan false (gizlilik)
 */
export function buildHealthAssistantWorkflow(config) {
  const wf = new WorkflowBuilder('Sağlık Asistanı');
  const credentialRef = ({ id, name }) => (id ? { id, name } : { name });
  const postgresCredentials = { postgres: credentialRef(config.postgresCredential) };

  const node = (kind, name, position, parameters, extra = {}) => {
    const [type, typeVersion] = NODE_TYPES[kind];
    return wf.addNode({ name, type, typeVersion, position, parameters, ...extra });
  };

  const webhook = (name, method, route, position) =>
    node('webhook', name, position, {
      httpMethod: method,
      path: `${API_BASE_PATH}/${route}`,
      responseMode: 'responseNode',
      options: { allowedOrigins: config.allowedOrigins },
    }, { webhookId: stableUuid(`webhook:${method}:${route}`) });

  const code = (name, position, file, invocation, notes) =>
    node('code', name, position, {
      mode: 'runOnceForEachItem',
      jsCode: bundleCodeModule(codeFile(file), invocation),
    }, notes ? { notes, notesInFlow: true } : {});

  const sql = (name, position, query, replacement) =>
    node('postgres', name, position, {
      operation: 'executeQuery',
      query,
      options: replacement ? { queryReplacement: `={{ ${replacement} }}` } : {},
    }, { credentials: postgresCredentials, onError: 'continueErrorOutput', alwaysOutputData: false });

  const respond = (name, position) =>
    node('respond', name, position, {
      respondWith: 'json',
      responseBody: '={{ JSON.stringify($json.body) }}',
      options: { responseCode: '={{ $json.status }}' },
    });

  const sticky = (name, position, width, height, content, color) =>
    node('sticky', name, position, { content, width, height, ...(color ? { color } : {}) });

  const aiChain = (name, position, systemPrompt, outputSchema, temperature) => {
    node('chain', name, position, {
      promptType: 'define',
      text: '={{ $json.prompt_input }}',
      hasOutputParser: true,
      needsFallback: Boolean(config.fallbackModel),
      messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: systemPrompt }] },
    }, {
      // Hata çıktısı kullanıldığında node içi hata yakalandığı için n8n'in "Retry On Fail"
      // ayarı devreye girmez; geçici sağlayıcı hatalarına karşı yedek model kullanılır.
      onError: 'continueErrorOutput',
    });

    const geminiNode = (nodeName, model, offsetX) => {
      node('gemini', nodeName, [position[0] + offsetX, position[1] + 200], {
        modelName: model,
        // Flash modellerinde düşünme token'ları da bu sınıra dahildir; JSON çıktıya yer kalmalı.
        options: { temperature, maxOutputTokens: 8192 },
      }, { credentials: { googlePalmApi: credentialRef(config.geminiCredential) } });
    };

    const modelName = `${name} · Gemini`;
    geminiNode(modelName, config.model, -80);

    const parserName = `${name} · Output schema`;
    node('parser', parserName, [position[0] + 200, position[1] + 200], {
      schemaType: 'manual',
      inputSchema: outputSchema,
    });

    wf.connect(modelName, name, { type: 'ai_languageModel' });
    if (config.fallbackModel) {
      const fallbackName = `${name} · Gemini (yedek)`;
      geminiNode(fallbackName, config.fallbackModel, 60);
      wf.connect(fallbackName, name, { type: 'ai_languageModel', index: 1 });
    }
    wf.connect(parserName, name, { type: 'ai_outputParser' });
    return name;
  };

  const persona = prompt('persona.md');

  // ===========================================================================
  // POST /health-assistant/chat
  // ===========================================================================
  sticky('Note: chat', [-60, -460], 2900, 1480, [
    '## POST /health-assistant/chat — Sohbet',
    'Gövde: `{ request_id, user_id, conversation_id | null, message }`',
    '1. Girdi doğrulama → 2. Supabase\'ten profil + geçmiş (ID ile) → 3. Acil durum ön kontrolü ve bağlam',
    '4. **Route message**: tekrar istek · ACİL (112, model çağrılmaz) · konuşma yok · **Selamla** (profil eksik/yeni) · **Semptom Analizi** (profil hazır)',
    '5. Gemini + yapılandırılmış çıktı → doğrulama → tek transaction ile kayıt → JSON cevap',
  ].join('\n'));

  webhook('POST /chat', 'POST', 'chat', [0, 0]);
  code('Validate request', [220, 0], 'validate-chat-request.js',
    'return { json: validateChatRequest($json.body) };');
  node('if', 'Request valid?', [440, 0], { conditions: booleanCondition('request-valid', '$json.ok', true), options: {} });
  sql('DB: load chat context', [660, -20],
    'select health.get_chat_context($1::uuid, nullif($2, \'\')::uuid, $3::uuid) as context;',
    "[$json.request.user_id, $json.request.conversation_id ?? '', $json.request.request_id]");
  code('Assess message', [880, -20], 'assess-message.js',
    "return { json: assessMessage($('Validate request').first().json.request, $json.context) };",
    'Profil eksikleri, acil belirti taraması ve prompt bağlamı');

  node('switch', 'Route message', [1100, -20], {
    mode: 'rules',
    rules: {
      values: [
        { conditions: booleanCondition('route-replay', '$json.replay !== null', true), renameOutput: true, outputKey: 'Replay' },
        // Acil durum, konuşma bulunamasa bile önce gelir: 112 yönlendirmesi asla 404 ile engellenmez.
        { conditions: booleanCondition('route-emergency', '$json.safety.is_emergency', true), renameOutput: true, outputKey: 'Emergency' },
        { conditions: booleanCondition('route-conversation', '$json.conversation_found', false), renameOutput: true, outputKey: 'Conversation not found' },
        { conditions: booleanCondition('route-greeting', '$json.missing_profile_fields.length > 0', true), renameOutput: true, outputKey: 'Greeting' },
      ],
    },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'Symptom analysis' },
  });

  code('Format replay response', [1380, -400], 'responses.js',
    'return { json: formatChatResponse({ ...$json.replay, request_id: $json.request_id, replayed: true, profile: $json.profile }) };');
  code('Build emergency reply', [1380, -240], 'build-turn.js',
    'return { json: buildEmergencyTurn($json) };', 'Sabit 112 yönlendirmesi');
  code('Conversation not found', [1380, -80], 'responses.js',
    'return { json: conversationNotFound($json.request_id) };');

  aiChain('AI: Greeting', [1380, 100], `${persona}\n\n${prompt('greeting.md')}`, schema('greeting-output.json'), 0.4);
  aiChain('AI: Symptom analysis', [1380, 520], `${persona}\n\n${prompt('symptom-analysis.md')}`, schema('symptom-output.json'), 0.3);

  code('Validate greeting output', [1700, 100], 'build-turn.js',
    "return { json: validateAiOutput($json, $('Assess message').first().json, 'greeting') };");
  code('Validate analysis output', [1700, 520], 'build-turn.js',
    "return { json: validateAiOutput($json, $('Assess message').first().json, 'symptom_analysis') };");
  code('AI unavailable', [1700, 800], 'responses.js',
    "return { json: aiUnavailable($json, $('Validate request').first().json.request.request_id) };");

  node('if', 'AI output valid?', [1940, 300], { conditions: booleanCondition('ai-valid', '$json.ok', true), options: {} });
  sql('DB: save turn', [2180, -80],
    'select health.save_chat_turn($1::jsonb) as saved;',
    '[JSON.stringify($json.turn)]');
  code('Format chat response', [2400, -100], 'responses.js',
    'return { json: formatChatResponse($json.saved) };');
  code('Map chat error', [2400, 360], 'responses.js',
    "return { json: mapNodeError($json, $('Validate request').first().json.request?.request_id ?? null) };");
  respond('Respond to client', [2660, 100]);

  wf.connect('POST /chat', 'Validate request');
  wf.connect('Validate request', 'Request valid?');
  wf.connect('Request valid?', 'DB: load chat context', { output: 0 });
  wf.connect('Request valid?', 'Respond to client', { output: 1 });
  wf.connect('DB: load chat context', 'Assess message', { output: 0 });
  wf.connect('DB: load chat context', 'Map chat error', { output: 1 });
  wf.connect('Assess message', 'Route message');
  wf.connect('Route message', 'Format replay response', { output: 0 });
  wf.connect('Route message', 'Build emergency reply', { output: 1 });
  wf.connect('Route message', 'Conversation not found', { output: 2 });
  wf.connect('Route message', 'AI: Greeting', { output: 3 });
  wf.connect('Route message', 'AI: Symptom analysis', { output: 4 });
  wf.connect('Format replay response', 'Respond to client');
  wf.connect('Conversation not found', 'Respond to client');
  wf.connect('Build emergency reply', 'DB: save turn');
  wf.connect('AI: Greeting', 'Validate greeting output', { output: 0 });
  wf.connect('AI: Greeting', 'AI unavailable', { output: 1 });
  wf.connect('AI: Symptom analysis', 'Validate analysis output', { output: 0 });
  wf.connect('AI: Symptom analysis', 'AI unavailable', { output: 1 });
  wf.connect('Validate greeting output', 'AI output valid?');
  wf.connect('Validate analysis output', 'AI output valid?');
  wf.connect('AI unavailable', 'Respond to client');
  wf.connect('AI output valid?', 'DB: save turn', { output: 0 });
  wf.connect('AI output valid?', 'Respond to client', { output: 1 });
  wf.connect('DB: save turn', 'Format chat response', { output: 0 });
  wf.connect('DB: save turn', 'Map chat error', { output: 1 });
  wf.connect('Format chat response', 'Respond to client');
  wf.connect('Map chat error', 'Respond to client');

  // ===========================================================================
  // Destek uç noktaları: profil listesi, geçmiş, veri silme
  // ===========================================================================
  sticky('Note: support', [-60, 1100], 1700, 820, [
    '## Destek uç noktaları',
    '- `GET /health-assistant/profiles` — profil seçici için 15 demo profil',
    '- `GET /health-assistant/history?user_id=&conversation_id=` — kullanıcının (son) konuşması',
    '- `DELETE /health-assistant/user-data?user_id=` — demo dışı kullanıcının tüm verisini siler',
  ].join('\n'), 7);

  webhook('GET /profiles', 'GET', 'profiles', [0, 1260]);
  sql('DB: list demo profiles', [220, 1260], 'select health.list_demo_profiles() as profiles;');
  code('Format profiles', [440, 1260], 'responses.js', 'return { json: formatProfilesResponse($json.profiles) };');

  webhook('GET /history', 'GET', 'history', [0, 1480]);
  code('Validate history query', [220, 1480], 'responses.js',
    'return { json: validateUserQuery($json.query, { allowConversation: true }) };');
  node('if', 'History query valid?', [440, 1480], { conditions: booleanCondition('history-valid', '$json.ok', true), options: {} });
  sql('DB: conversation history', [660, 1460],
    'select health.get_conversation_history($1::uuid, nullif($2, \'\')::uuid) as history;',
    "[$json.query.user_id, $json.query.conversation_id ?? '']");
  code('Format history', [880, 1460], 'responses.js', 'return { json: formatHistoryResponse($json.history) };');

  webhook('DELETE /user-data', 'DELETE', 'user-data', [0, 1720]);
  code('Validate delete query', [220, 1720], 'responses.js', 'return { json: validateUserQuery($json.query) };');
  node('if', 'Delete query valid?', [440, 1720], { conditions: booleanCondition('delete-valid', '$json.ok', true), options: {} });
  sql('DB: delete user data', [660, 1700], 'select health.delete_user_data($1::uuid) as result;', '[$json.query.user_id]');
  code('Format delete result', [880, 1700], 'responses.js', 'return { json: formatDeleteResponse($json.result) };');

  code('Map support error', [1100, 1620], 'responses.js', 'return { json: mapNodeError($json) };');
  respond('Respond (support)', [1360, 1480]);

  wf.connect('GET /profiles', 'DB: list demo profiles');
  wf.connect('DB: list demo profiles', 'Format profiles', { output: 0 });
  wf.connect('DB: list demo profiles', 'Map support error', { output: 1 });
  wf.connect('Format profiles', 'Respond (support)');

  wf.connect('GET /history', 'Validate history query');
  wf.connect('Validate history query', 'History query valid?');
  wf.connect('History query valid?', 'DB: conversation history', { output: 0 });
  wf.connect('History query valid?', 'Respond (support)', { output: 1 });
  wf.connect('DB: conversation history', 'Format history', { output: 0 });
  wf.connect('DB: conversation history', 'Map support error', { output: 1 });
  wf.connect('Format history', 'Respond (support)');

  wf.connect('DELETE /user-data', 'Validate delete query');
  wf.connect('Validate delete query', 'Delete query valid?');
  wf.connect('Delete query valid?', 'DB: delete user data', { output: 0 });
  wf.connect('Delete query valid?', 'Respond (support)', { output: 1 });
  wf.connect('DB: delete user data', 'Format delete result', { output: 0 });
  wf.connect('DB: delete user data', 'Map support error', { output: 1 });
  wf.connect('Format delete result', 'Respond (support)');

  wf.connect('Map support error', 'Respond (support)');

  return wf.toJSON({
    executionOrder: 'v1',
    // Sağlık metni içeren başarılı çalıştırmalar varsayılan olarak saklanmaz.
    saveDataSuccessExecution: config.saveSuccessfulExecutions ? 'all' : 'none',
    saveDataErrorExecution: 'all',
    saveManualExecutions: true,
    executionTimeout: 90,
  });
}
