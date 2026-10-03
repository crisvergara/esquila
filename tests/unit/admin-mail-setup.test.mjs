import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('mail setup imports secrets over stdin and preserves an existing outbox key', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'esquila-mail-setup-'));
  try {
    const fake=path.join(dir,'flyctl'), captured=path.join(dir,'stdin');
    await writeFile(fake,`#!/bin/sh
case "$1 $2" in
  'secrets list') printf '%s' "$TEST_SECRET_NAMES" ;;
  'secrets import') cat > "$TEST_CAPTURE_FILE" ;;
  *) exit 2 ;;
esac
`,{mode:0o700});
    const secret='fake-test-smtp-$notExpanded\\"#value';
    for(const existing of [false,true]) {
      const result=spawnSync('/bin/bash',['scripts/configure-admin-mail.sh'], {encoding:'utf8',input:`\n\nmail@example.test\nsmtp.example.test\n587\ntest-user\n${secret}\n`,env:{...process.env,PATH:dir+path.delimiter+process.env.PATH,TEST_SECRET_NAMES:existing?'[{"Name":"ADMIN_LINK_KEY"}]':'[]',TEST_CAPTURE_FILE:captured}});
      assert.equal(result.status,0,result.stderr);
      const values=Object.fromEntries((await readFile(captured,'utf8')).trim().split('\n').map(line=>{const eq=line.indexOf('=');return [line.slice(0,eq),line.slice(eq+2,-1)];}));
      assert.equal(Buffer.from(values.ADMIN_SMTP_PASSWORD_B64,'base64').toString('utf8'),secret);
      assert.equal(Buffer.from(values.ADMIN_SMTP_USER_B64,'base64').toString('utf8'),'test-user');
      assert.equal(values.PUBLIC_URL,'https://esquila-cloud.fly.dev');
      if(existing) assert.equal(values.ADMIN_LINK_KEY,undefined);
      else assert.equal(Buffer.from(values.ADMIN_LINK_KEY,'base64').length,32);
      assert.ok(!result.stdout.includes(secret));assert.ok(!result.stderr.includes(secret));
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
