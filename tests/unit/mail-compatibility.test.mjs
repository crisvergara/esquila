import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { SendEmailCommand } from '@aws-sdk/client-sesv2';

test('patched mail library preserves the barn SESv2 integration without contacting AWS',async()=>{
  let input;
  const sesClient={config:{region:async()=>'us-east-1'},send:async(command)=>{input=command.input;return {MessageId:'test-only-message'};}};
  const transport=nodemailer.createTransport({SES:{sesClient,SendEmailCommand}});
  const result=await transport.sendMail({from:'sender@example.test',to:'ranch@example.test',subject:'Test QR',text:'Test-only barn link',attachments:[{filename:'qr.png',content:Buffer.from('fake-qr-for-test')}]});
  assert.match(result.messageId,/test-only-message/);
  assert.deepEqual(input.Destination.ToAddresses,['ranch@example.test']);
  assert.match(Buffer.from(input.Content.Raw.Data).toString(),/qr\.png/);
});
