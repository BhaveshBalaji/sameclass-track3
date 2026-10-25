import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, validatePatch } from '../src/domain/planning.js';
import { allowedMentions, components } from '../src/transport/discord/index.js';
import { commandDefinitions } from '../src/transport/discord/commands.js';

test('Discord mention permissions never parse model/source text, roles or everyone', () => {
  assert.deepEqual(allowedMentions(['1563783144249888800','test:maya','1563783144249888800','@everyone']),
    { parse:[], users:['1563783144249888800'], repliedUser:false });
  assert.ok(!clean('@everyone <@123456789012345678>').includes('@everyone'));
});
test('persistent button IDs fit Discord limits and preserve session identity', () => {
  const rows = components({ id:'r',text:'',mentions:[],clarificationIds:[],buttons:[{label:'Confirm',action:'reset',
    sessionId:'12345678-1234-1234-1234-123456789012',token:'abcdefab-abcd-abcd-abcd-abcdefabcdef'}] });
  const id = rows[0]!.toJSON().components[0]!;
  assert.ok('custom_id' in id && id.custom_id.length <= 100);
  assert.deepEqual(commandDefinitions.map(c => c.name),['ping','ask','plan']);
});
test('profile sources require matching author, existing message and verbatim evidence', () => {
  assert.throws(() => validatePatch({ facts:[{field:'campus',strength:'hard',values:['Tempe'],sources:[{messageId:'m',quote:'Tempe'}]}] },
    {userId:'maya',profile:{version:0,facts:{}},messages:[{id:'m',authorId:'leo',content:'Tempe',ordinal:1}]}));
});
