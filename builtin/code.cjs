const CODE_ALIASES = { js:'javascript',jsx:'javascriptreact',mjs:'javascript',cjs:'javascript',ts:'typescript',tsx:'typescriptreact',py:'python',sh:'shellscript',bash:'shellscript',zsh:'shellscript',ps1:'powershell',yml:'yaml',rs:'rust',kt:'kotlin',cs:'csharp','c++':'cpp' };
function codeLanguage(value) { const name = String(value || '').trim().toLowerCase(); return CODE_ALIASES[name] || name || 'plaintext'; }
const CODE_WORDS = {
  javascript:'async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield true false null undefined',
  typescript:'abstract any as boolean declare enum implements infer interface is keyof namespace never number private protected public readonly record satisfies string symbol type unknown',
  python:'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None',
  shellscript:'if then else elif fi for in do done while until case esac function select time',
  sql:'select from where join inner outer left right on as group order by having limit insert into values update set delete create alter drop table index primary key null true false and or not in is distinct union all begin commit rollback',
  json:'true false null',jsonc:'true false null',yaml:'true false null',toml:'true false',css:'',scss:'',
  powershell:'if else elseif for foreach while do until switch function param begin process end return break continue throw try catch finally $true $false $null',
  ruby:'class module def end do if elsif else unless until for in while begin rescue ensure return yield super self require include private public protected true false nil and or not case when then',
  common:'if else for while do return break continue switch case default class struct enum interface public private protected static final const let var new try catch finally throw import package using namespace void true false null'
};
function codeTokens(text, language) {
  const lang = codeLanguage(language), family = ['javascript','javascriptreact','typescript','typescriptreact'].includes(lang) ? 'javascript' : ['python','shellscript','sql'].includes(lang) ? lang : ['java','kotlin','c','cpp','csharp','go','rust','css','scss','json','jsonc','yaml','toml','powershell','ruby'].includes(lang) ? 'common' : null;
  if (!family || text.length > 200000) return [{ kind:'plain',text }];
  const words = new Set((lang.startsWith('typescript') ? CODE_WORDS.javascript + ' ' + CODE_WORDS.typescript : CODE_WORDS[lang] ?? CODE_WORDS[family]).split(' '));
  const hash = ['python','shellscript','powershell','yaml','toml','ruby'].includes(lang), slash = !hash && family !== 'sql' && lang !== 'json';
  const identifier = /[\p{L}_$][\p{L}\p{M}\p{N}_$]*/uy, number = /(?:0[xob][\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)(?:n\b)?/iy;
  const tokens = []; let position=0, plain=0;
  while(position<text.length) {
    let end=position,kind;
    if (hash && text[position]==='#' || slash && text.startsWith('//',position) || family==='sql' && text.startsWith('--',position)) { end=text.indexOf('\n',position);if(end<0)end=text.length;kind='comment'; }
    else if ((slash || family==='sql') && text.startsWith('/*',position)) { end=text.indexOf('*/',position+2);end=end<0?text.length:end+2;kind='comment'; }
    else if ('"\''.includes(text[position]) || family==='javascript' && text[position]==='`') {
      const quote=text[position],triple=lang==='python'&&text.slice(position,position+3)===quote.repeat(3),width=triple?3:1;end=position+width;
      while(end<text.length){if(text[end]==='\\'){end=Math.min(text.length,end+2);continue;}if(text.slice(end,end+width)===quote.repeat(width)){end+=width;break;}if(!triple&&quote!=='`'&&text[end]==='\n')break;end++;}kind='string';
    } else {
      identifier.lastIndex=position;const word=identifier.exec(text);
      if(word){end=identifier.lastIndex;if(words.has(family==='sql'||lang==='powershell'?word[0].toLowerCase():word[0]))kind='keyword';}
      else { number.lastIndex=position;const numeric=number.exec(text);if(numeric){end=number.lastIndex;kind='number';} }
    }
    if(kind){if(position>plain)tokens.push({kind:'plain',text:text.slice(plain,position)});tokens.push({kind,text:text.slice(position,end)});plain=end;if(tokens.length>5000)return[{kind:'plain',text}];}
    position=end>position?end:position+1;
  }
  if(plain<text.length)tokens.push({kind:'plain',text:text.slice(plain)});
  return tokens;
}
if(typeof module!=='undefined')module.exports={codeLanguage,codeTokens};
