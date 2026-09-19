// Only advertise usable LAN addresses. VPN-only connectivity is not a barn LAN.
export function taggerConnectionInfo(interfaces, hostname, port) {
  const addresses = Object.entries(interfaces).flatMap(([name, entries]) => {
    if (/^(utun|tun|tap|tailscale|wg|docker|vbox|vmnet|awdl|llw)/i.test(name)) return [];
    return (entries || []).filter(entry => !entry.internal &&
      (entry.family === 'IPv4' || entry.family === 4) &&
      !/^(127\.|169\.254\.|0\.)/.test(entry.address)).map(entry => ({
      address: entry.address, interface: name,
      url: `http://${entry.address}:${port}/tagger/`,
      score: (/^(en\d+|wlan\d+|eth\d+)$/i.test(name) ? 100 : 0) +
        (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address) ? 20 : 0),
    }));
  }).sort((a, b) => b.score - a.score || a.interface.localeCompare(b.interface));
  const choices = addresses.map(({ score, ...entry }) => entry);
  return {
    url: choices[0]?.url || null,
    friendlyUrl: choices.length ? `http://${hostname.split('.')[0]}.local:${port}/tagger/` : null,
    addresses: choices,
  };
}
