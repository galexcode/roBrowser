/**
 * Core/MemoryManager.js
 *
 * Memory Manager
 *
 * Set up a cache context to avoid re-loading/parsing files each time, files are removed automatically if not used
 *
 * This file is part of ROBrowser, Ragnarok Online in the Web Browser (http://www.robrowser.com/).
 *
 * @author Vincent Thibault
 */

define( ['Core/MemoryItem'], function( MemoryItem )
{
	"use strict";


	/**
	 * List of files in memory
	 * @var List MemoryItem
	 */
	var _memory = {};


	/**
	 * Remove files from memory if not used until a period of time
	 * @var {number}
	 */
	var _remember_time = 2 * 60 * 1000; // 2 min


	/**
	 * @var {number} last time we clean up variables
	 */
	var _lastCheckTick = 0;


	/**
	 * @var {number} perform the clean up every 30 secs
	 */
	var _cleanUpInterval = 30 * 1000;


	/**
	 * Get back data from memory
	 *
	 * @param {string} filename
	 * @param {function} onload - optional
	 * @param {function} onerror - optional
	 * @return mixed data
	 */
	function Get( filename, onload, onerror )
	{
		var item;

		// Not in memory yet, create slot
		if( !Exist(filename) ) {
			_memory[filename] = new MemoryItem();
		}

		item = _memory[filename];

		if( onload ) {
			item.addEventListener('load', onload );
		}

		if( onerror ) {
			item.addEventListener('error', onerror );
		}

		return item.data;
	}


	/**
	 * Check if the entry exists
	 *
	 * @param {string} filename
	 * @return boolean isInMemory
	 */
	function Exist( filename )
	{
		return filename in _memory;
	}


	/**
	 * Stored data in memory
	 *
	 * @param {string} filename
	 * @param {string|object} data
	 * @param {string} error - optional
	 */
	function Set( filename, data, error )
	{
		// Not in memory yet, create slot
		if( !Exist(filename) ) {
			_memory[filename] = new MemoryItem();
		}

		if( error || !data) {
			_memory[filename].onerror( error );
		}
		else {
			_memory[filename].onload( data );
		}
	}


	/**
	 * Clean up not used data from memory
	 *
	 * @param {object} gl - WebGL Context
	 * @param {number} now - game tick
	 */
	function Clean( gl, now )
	{
		if( _lastCheckTick + _cleanUpInterval > now ) {
			return;
		}

		var keys, item;
		var i, count, tick;
		var list = [];

		keys  = Object.keys(_memory);
		count = keys.length;
		tick  = now - _remember_time;

		for( i=0; i<count; ++i ) {
			item = _memory[ keys[i] ];
			if( item.complete && item.lastTimeUsed < tick  ) {
				Remove( gl, keys[i] );
				list.push( keys[i] );
			}	
		}

		if( list.length ) {
			console.log( '%c[MemoryManager] - Removing ' +  list.length + ' unused elements from memory.', 'color:#d35111', list);
		}

		_lastCheckTick = now;
	}


	/**
	 * Remove Item from memory
	 *
	 * @param {object} gl - WebGL Context
	 * @param {string} filename
	 */
	function Remove( gl, filename )
	{
		// Not found ?
		if( !Exist(filename) ) {
			return;
		}

		var file = Get( filename );
		var ext  = "";
		var i, count;

		var matches = filename.match(/\.[^\.]+$/);

		if ( matches ) {
			ext = matches.toString().toLowerCase();
		}

		// Free file
		if( file ) {
			switch( ext ) {

				// Delete GPU textures from sprites
				case '.spr':
					if( file.frames ) {
						for( i = 0, count = file.frames.length; i < count; ++i ) {
							if( file.frames[i].texture && gl.isTexture(file.frames[i].texture) ) {
								gl.deleteTexture( file.frames[i].texture );
							}
						}
					}
					//break;

				// Delete palette
				case '.pal':
					if( file.texture && gl.isTexture(file.texture) ) {
						gl.deleteTexture( file.texture );
					}
					break;
	
				// If file is a blob, remove it (wav, mp3, lua, lub, txt, ...)
				default:
					if( file.match && file.match(/^blob\:/) ) {
						URL.revokeObjectURL(file);
					}
					break;
			}
		}

		// Delete from memory
		delete _memory[filename];
	}


	/**
	 * Search files in memory based on a regex
	 *
	 * @param regex
	 * @return string[] filename
	 */
	function Search(regex)
	{
		var keys;
		var i, count, out = [];

		keys  = Object.keys(_memory);
		count = keys.length;

		for( i=0; i<count; ++i ) {
			if( keys[i].match(regex) ) {
				out.push( keys[i] );
			}
		}

		return out;
	}


	/**
	 * Export methods
	 */
	return {
		get:    Get,
		set:    Set,
		clean:  Clean,
		remove: Remove,
		exist:  Exist,
		search: Search
	};
});