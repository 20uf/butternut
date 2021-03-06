import { parse } from 'acorn';
import { decode } from 'sourcemap-codec';
import keys from './keys.js';
import Program from './Program.js';

export default function check ( magicString, ast ) {
	const code = magicString.toString();

	try {
		parse( code, {
			ecmaVersion: 8,
			sourceType: 'module'
		});
	} catch ( err ) {
		const map = magicString.generateMap();
		const { line, column } = err.loc;
		const snippet = code.slice( Math.max( 0, err.pos - 35 ), Math.min( code.length, err.pos + 35 ) );

		const mappings = decode( map.mappings );
		const segments = mappings[ line - 1 ];

		for ( let i = 0; i < segments.length; i += 1 ) {
			const segment = segments[i];
			if ( segment[0] >= column ) {
				const sourceCodeLine = segment[2];
				const sourceCodeColumn = segment[3];

				err.message = `Butternut generated invalid JS: code in source file near (${sourceCodeLine + 1}:${sourceCodeColumn}) became\n...${snippet}...`;

				try {
					const repro = createRepro( magicString.original, ast, sourceCodeLine, sourceCodeColumn );
					if ( repro ) err.repro = repro;
				} catch (err) {
					// do nothing
				}

				throw err;
			}
		}

		throw err;
	}
}

function createRepro ( source, ast, line, column ) {
	const lines = source.split( '\n' );

	let c = 0;
	for ( let i = 0; i < line; i += 1 ) c += lines[i].length + 1;
	c += column;

	let node = zoomIn( ast, c );

	do {
		node = zoomOut( node );

		const slice = source.slice( node.start, node.end );
		const ast = parse( slice, {
			ecmaVersion: 8,
			preserveParens: true,
			sourceType: 'module',
			allowReturnOutsideFunction: true
		});

		const { code } = new Program( slice, ast, null ).export({});

		try {
			parse( code, {
				ecmaVersion: 8,
				sourceType: 'module',
				allowReturnOutsideFunction: true
			});
		} catch ( err ) {
			return {
				input: slice,
				output: code
			};
		}
	} while ( node );
}

function zoomIn ( node, c ) {
	if ( !node ) return null;

	if ( c < node.start ) return null;
	if ( c > node.end ) return null;

	const k = keys[ node.type ];
	for ( let i = 0; i < k.length; i += 1 ) {
		const key = k[i];

		if ( Array.isArray( node[key] ) ) {
			const body = node[key];

			for ( let j = 0; j < body.length; j += 1 ) {
				if ( body[j] ) {
					if ( body[j].start > c ) return zoomIn( body[j], body[j].start );

					const child = zoomIn( body[j], c );
					if ( child ) return child;
				}
			}
		} else {
			const child = zoomIn( node[key], c );
			if ( child ) return child;
		}
	}

	return node;
}

function zoomOut ( node ) {
	while ( !/Statement|Declaration/.test( node.parent.type ) ) {
		if ( !node.parent ) return null;
		node = node.parent;
	}

	return node.parent;
}