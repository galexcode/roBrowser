/**
 * Network/NetworkManager.js
 *
 * Network Manager
 * Manage sockets and packets
 *
 * This file is part of ROBrowser, Ragnarok Online in the Web Browser (http://www.robrowser.com/).
 *
 * @author Vincent Thibault
 */

define([ 'require', 'Core/Context', 'Utils/BinaryReader',   './PacketVerManager', './PacketVersions', './PacketRegister', './PacketGuess', './PacketCrypt', './SocketHelpers/ChromeSocket', './SocketHelpers/JavaSocket', './SocketHelpers/WebSocket'],
function( require,        Context,         BinaryReader,       PACKETVER,            PacketVersions,     PacketRegister,     PacketGuess,     PacketCrypt,                   ChromeSocket,                   JavaSocket,                   WebSocket)
{
	"use strict";


	/**
	 * Sockets list
	 * @var Socket[]
	 */
	var _sockets = [];


	/**
	 * Current Socket
	 * @var Socket
	 */
	var _socket  = null;


	/**
	 * Max Packet Size (storage ? emblem ? skill ?)
	 * @var integer
	 */
	var MAX_PACKET_SIZE = 1024 * 2;


	/**
	 * Buffer to use to read packets
	 * @var buffer
	 */
	var _save_buffer         = null;


	/**
	 * Packets definition
	 *
	 * @param {string} name
	 * @param {callback} struct - callback to parse the packet
	 * @param {number} size - packet size
	 */
	function Packets( name, struct, size )
	{
		this.name     = name;
		this.struct   = struct;
		this.size     = size;
		this.callback = null;
		this.guess    = null;
	}


	/**
	 * List of supported packets
	 * @var Packets[]
	 */
	Packets.list = [];



	/**
	 * Connect to a server
	 *
	 * @param {string} host
	 * @param {number} port
	 * @param {function} callback once connected or not
	 * @param {boolean} is zone server ?
	 */
	function Connect( host, port, callback, isZone)
	{
		var socket, Socket;
		var proxy = ROConfig.socketProxy || null;

		// Native socket
		if (Context.Is.APP) {
			Socket = ChromeSocket;
		}

		// Web Socket with proxy
		else if (ROConfig.socketProxy) {
			Socket = WebSocket;
		}
	
		// Java socket...
		else {
			Socket = JavaSocket;
		}

		socket            = new Socket(host, port, proxy);
		socket.isZone     = !!isZone;
		socket.onClose    = OnClose;
		socket.onComplete = function OnComplete(success)
		{
			var msg = "Fail";

			if (success) {
				msg = "Success";

				// If current socket has ping, remove it
				if (_socket && _socket.ping) {
					clearInterval(_socket.ping);
				}

				socket.onMessage = Receive;
				_sockets.push(_socket = socket);

				// Map server encryption
				if (isZone) {
					PacketCrypt.init();
				}
			}

			console.warn( "Network::Connect() - " + msg + " to connect to " + host + ":" + port);
			callback.call( this, success);
		};
	}


	/**
	 * Send a packet to the server
	 *
	 * @param Packet
	 */
	function SendPacket( Packet )
	{
		console.log( "%c[Network] Send: ", "color:#007070", Packet );
		var pkt = Packet.build();

		// Encrypt packet
		if (_socket && _socket.isZone) {
			PacketCrypt.process(pkt.view);
		}

		Send( pkt.buffer );
	}


	/**
	 * Send buffer to the server
	 *
	 * @param {ArrayBuffer} buffer
	 */
	function Send( buffer ) {
		if (_socket) {
			_socket.send( buffer );
		}
	}


	/**
	 * Register a Packet
	 * 
	 * @param {number} id - packet UID
	 * @param {function} struct - packet structure callback
	 */
	function RegisterPacket( id, struct ) {
		struct.id = id;
		Packets.list[id] = new Packets(
			struct.name,
			struct,
			struct.size
		);
	}


	/**
	 * Hook a Packet
	 *
	 * @param {object} packet
	 * @param {function} callback to use packet
	 */
	function HookPacket( packet, callback )
	{
		if (!packet.id) {
			throw new Error('NetworkManager::HookPacket() - Packet not yet register "'+ packet.name +'"');	
		}

		Packets.list[ packet.id ].callback = callback;
	}


	/**
	 * Register a function for a packet to guess the procole version
	 *
	 * @param {object} packet
	 * @param {function} callback to guess PACKETVER
	 */
	function GuessPacketVer( packet, callback)
	{
		if (!packet.id) {
			throw new Error('NetworkManager::GuessPacketVer() - Packet not yet register "'+ packet.name +'"');	
		}
		Packets.list[ packet.id ].guess = callback;
	}


	/**
	 * Force to read from a used version for the next receive data
	 *
	 * @param callback
	 */
	function Read(callback)
	{
		Read.callback = callback;
	}


	/**
	 * Callback used for reading the data for the next buffer received from server
	 * @var callback
	 */
	Read.callback = null;



	/**
	 * Received data from server
	 *
	 * @param {Uint8Array} buffer
	 */
	function Receive( buf )
	{
		var id, packet, fp;
		var length = 0;
		var offset = 0;
		var buffer;


		// Waiting for data ? concat the buffer
		if (_save_buffer) {
			var _data = new Uint8Array( _save_buffer.length + buf.byteLength );
			_data.set( _save_buffer, 0 );
			_data.set( new Uint8Array(buf), _save_buffer.length );
			buffer = _data.buffer;
		}
		else {
			buffer = buf;
		}

		fp = new BinaryReader( buffer );


		// Read hook
		if (Read.callback) {
			Read.callback( fp );
			Read.callback = null;
		}


		// Read and parse packets
		while (fp.tell() < fp.length) {

			offset = fp.tell();

			// Not enough bytes...
			if (offset + 2 >= fp.length) {
				_save_buffer = new Uint8Array( buffer, offset, fp.length - offset);
				return;
			}

			id     = fp.readUShort();

			// Packet not defined ?
			if (!Packets.list[id]) {
				console.error(
					"[Network] Packet '%c0x%s%c' not register, skipping %d bytes.",
					"font-weight:bold", id.toString(16), "font-weight:normal", (fp.length-fp.tell())
				);
				break;
			}

			// Find packet size
			packet  = Packets.list[id];

			if (packet.size < 0) {
				// Not enough bytes...
				if (offset + 4 >= fp.length) {
					_save_buffer = new Uint8Array( buffer, offset, fp.length - offset );
					return;
				}
				length = fp.readUShort();
			}
			else {
				length = packet.size;
			}

			offset += length;

			// Try to guess the packet version
			if (packet.guess && PACKETVER.min !== PACKETVER.max) {
				packet.guess( length );
			}

			// Not enough bytes, need to wait for new buffer to read more.
			if (offset > fp.length) {
				offset       = fp.tell() - (packet.size < 0 ? 4 : 2);
				_save_buffer = new Uint8Array(
					buffer,
					offset,
					fp.length - offset
				);
				return;
			}

			// Parse packet
			var data = new packet.struct(fp, offset);
			console.log( "%c[Network] Recv:", "color:#900090", data, packet.callback ? "" : "(no callback)"  );

			// Support for "0" type
			if (length) {
				fp.seek( offset, SEEK_SET );
			}

			// Call controller
			if (packet.callback) {
				packet.callback(data);
			}
		}

		_save_buffer = null;
	}


	/**
	 * Communication end
	 * Server ask to close the socket
	 */
	function OnClose()
	{
		var idx = _sockets.indexOf(this);

		if (this === _socket) {
			console.warn("[Network] Disconnect from server");

			if (_socket.ping) {
				clearInterval(_socket.ping);
			}

			require('UI/UIManager').showErrorBox('Disconnected from Server.');
		}

		if (idx !== -1) {
			_sockets.splice(idx, 1);
		}
	}


	/**
	 * Close connection with server
	 * Is this needed ?
	 */
	function Close()
	{
		var idx;

		if (_socket) {
			_socket.close();

			if (_socket.izZone) {
				PacketCrypt.reset();
			}

			if (_socket.ping) {
				clearInterval(_socket.ping);
			}

			idx     = _sockets.indexOf(_socket);
			_socket = null;

			if (idx !== -1) {
				_sockets.splice(idx, 1);
			}
		}
	}


	/**
	 * Define a ping
	 *
	 * @param callback
	 */
	function SetPing( callback )
	{
		if (_socket) {
			if (_socket.ping) {
				clearInterval(_socket.ping);
			}
			_socket.ping = setInterval( callback, 10000);

			while (_sockets.length > 1) {
				if (_socket !== _sockets[0]) {
					_sockets[0].close();
					_sockets.splice( 0, 1 );
				}
			}
		}
	}


	/**
	 * Get back ip from long
	 *
	 * @param {number} long ip
	 * @return {string} ip
	 */
	function UtilsLongToIP( long )
	{
		var buf    = new ArrayBuffer(4);
		var uint8  = new Uint8Array(buf);
		var uint32 = new Uint32Array(buf);
		uint32[0]  = long;

		return Array.prototype.join.call( uint8, "." );
	}


	/**
	 * Export
	 */
	return new function Network()
	{
		this.sendPacket     = SendPacket;
		this.send           = Send;
		this.setPing        = SetPing;
		this.connect        = Connect;
		this.guessPacketVer = GuessPacketVer;
		this.hookPacket     = HookPacket;
		this.close          = Close;
		this.read           = Read;

		var keys;
		var i, count;

		// Add packet version
		keys  = Object.keys(PacketVersions);
		count = keys.length;

		for (i = 0; i < count; ++i) {
			PACKETVER.addSupport( keys[i], PacketVersions[ keys[i] ] );
		}

		// Register packets
		keys  = Object.keys(PacketRegister);
		count = keys.length;

		for (i = 0; i < count; ++i) {
			RegisterPacket( keys[i], PacketRegister[ keys[i] ] );
		}

		// Guess packetver
		PacketGuess.call(this);

		this.utils = {
			longToIP: UtilsLongToIP
		};
	};
});