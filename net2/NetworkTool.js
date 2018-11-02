/*    Copyright 2016 Firewalla LLC
 *
 *    This program is free software: you can redistribute it and/or  modify
 *    it under the terms of the GNU Affero General Public License, version 3,
 *    as published by the Free Software Foundation.
 *
 *    This program is distributed in the hope that it will be useful,
 *    but WITHOUT ANY WARRANTY; without even the implied warranty of
 *    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *    GNU Affero General Public License for more details.
 *
 *    You should have received a copy of the GNU Affero General Public License
 *    along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
'use strict';

const log = require('./logger.js')(__filename);

const Promise = require('bluebird');

const linux = require('../util/linux.js');

const fConfig = require('../net2/config.js').getConfig();

const os = require('os');
const ip = require('ip');
const dns = require('dns');

const async = require('asyncawait/async');
const await = require('asyncawait/await');

const am2 = new require('../alarm/AlarmManager2.js')();
const Alarm = require('../alarm/Alarm.js');

let instance = null;

class NetworkTool {
  constructor() {
    if (!instance) {
      instance = this;
    }
    return instance;
  }

  _is_interface_valid(netif) {
    return (
      netif.ip_address != null &&
      netif.mac_address != null &&
      netif.type != null &&
      !netif.ip_address.startsWith('169.254.')
    );
  }

  // returns CIDR or null
  _getSubnet(networkInterface, family) {
    let interfaceData = os.networkInterfaces()[networkInterface.name];
    if (interfaceData == null) {
      return null
    }

    var ipSubnets = [];

    interfaceData.forEach(osIf => {
      if (osIf.family == family && !osIf.internal && osIf.cidr != null) {
        ipSubnets.push(osIf.cidr);
      }
    });

    return ipSubnets[0];
  }


  // listInterfaces(), output example:
  // [
  //   {
  //     name: 'eth0',
  //     ip_address: '192.168.10.4',
  //     mac_address: '02:81:05:84:b0:5d',
  //     ip6_addresses: ['fe80::81:5ff:fe84:b05d'],
  //     ip6_masks: ['ffff:ffff:ffff:ffff::'],
  //     gateway_ip: '192.168.10.1',
  //     netmask: 'Mask:255.255.255.0',
  //     type: 'Wired',
  //     gateway: '192.168.10.1',
  //     subnet: '192.168.10.0/24',
  //     gateway6: '',
  //     dns: ['192.168.10.1'],
  //   },
  //   {
  //     name: 'eth0:0',
  //     ip_address: '192.168.218.1',
  //     mac_address: '02:81:05:84:b0:5d',
  //     netmask: 'Mask:255.255.255.0',
  //     type: 'Wired',
  //     gateway: null,
  //     subnet: '192.168.218.0/24',
  //     gateway6: '',
  //     dns: ['192.168.10.1'],
  //   },
  // ]
  listInterfaces() {
    return new Promise((resolve, reject) => {
      linux.get_network_interfaces_list((err, list) => {
        if (list == null || list.length <= 0) {
          log.error('Discovery::Interfaces', 'No interfaces found');
          resolve([]);
          return;
        }

        list = list.filter(this._is_interface_valid);

        list.forEach(i => {
          log.info('Found interface', i.name, i.ip_address);

          i.gateway = require('netroute').getGateway(i.name);
          i.subnet = this._getSubnet(i.name, 'IPv4');
          i.gateway6 = linux.gateway_ip6_sync();
          i.dns = dns.getServers();
        });

        resolve(list);
      });
    });
  }

  // same as listInterfaces() but filters out non-local interfaces
  getLocalNetworkInterface() {
    let intfs = fConfig.discovery && fConfig.discovery.networkInterfaces;
    if (!intfs) {
      return Promise.resolve(null);
    }

    return this.listInterfaces().then(list => {
      let list2 = list.filter(x => {
        return intfs.includes(y => y === x.name);
      });
      if (list2.length === 0) {
        return null;
      } else {
        return list2;
      }
    });
  }

  // same as getSubnet() but filters non-local interfaces
  getLocalNetworkSubnets() {
    return async(() => {
      let interfaces = await(this.getLocalNetworkInterface());
      // a very hard code for 16 subnet
      return interfaces && interfaces.map(x => reduceSubnetTo24(x.subnet));
    })();
  }

  reduceSubnetTo24(cidrAddr) {
    let subnet = ip.cidrSubnet(cidrAddr);
    if (subnet.subnetMaskLength < 24) return subnet.networkAddress + '/24';
    else return cidrAddr;
  }
}

module.exports = function() {
  return new NetworkTool();
};
