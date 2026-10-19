import { describe, expect, it } from 'vitest';
import { esIp } from './ip';

describe('esIp', () => {
  it('acepta IPv4 e IPv6 válidas', () => {
    for (const v of ['203.0.113.9', '0.0.0.0', '255.255.255.255', '2001:db8::1', '::1', '::ffff:1.2.3.4']) {
      expect(esIp(v)).toBe(true);
    }
  });
  it('rechaza lo demás', () => {
    for (const v of ['', 'no-es-ip', '256.1.1.1', '1.2.3', "1.2.3.4'; drop table", '1:2:3', 'gggg::1', '1.2.3.4/24']) {
      expect(esIp(v)).toBe(false);
    }
  });
});
