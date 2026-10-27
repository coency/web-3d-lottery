import sharp from 'sharp';

// Deterministic synthetic portraits; never downloads personal photos.
export function renderSimulationPortrait(n:number):Promise<Buffer>{
 if(!Number.isInteger(n)||n<1||n>5000)throw new RangeError("Invalid simulated portrait number");
 let state=n*2654435761>>>0;
 const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
 const pick=(a:string[])=>a[Math.floor(random()*a.length)]!;
 const hue=Math.floor(random()*360),shirt=Math.floor(random()*360);
 const skin=pick(['#f2c7a4','#e7b08a','#c98e68','#ad7554','#88563d','#f9d9bd']);
 const hair=pick(['#25202b','#4c302a','#6a4431','#b57b43','#ceaf76','#393d55']);
 const eyes=15+Math.floor(random()*9),face=37+Math.floor(random()*12),lift=Math.floor(random()*12);
 const hairstyles=[
  `<path d="M78 116Q66 49 121 45Q184 43 179 121L161 88Q125 112 91 87Z" fill="${hair}"/>`,
  `<path d="M77 155V88Q82 39 129 43Q182 44 181 98V155L164 138V87Q137 100 91 85V144Z" fill="${hair}"/>`,
  `<path d="M77 104Q70 63 91 58Q105 28 124 46Q150 28 166 56Q188 62 179 108L161 86L142 91L124 77L93 91Z" fill="${hair}"/>`,
  `<path d="M80 96Q82 47 129 48Q175 48 177 99L164 84Q115 67 89 99Z" fill="${hair}"/>`
 ];
 const glasses=random()>.55?`<g fill="none" stroke="${hair}" stroke-width="4"><rect x="${128-eyes-14}" y="100" width="28" height="20" rx="7"/><rect x="${128+eyes-14}" y="100" width="28" height="20" rx="7"/><path d="M${128-eyes+14} 107H${128+eyes-14}"/></g>`:'';
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="hsl(${hue},48%,68%)"/><stop offset="1" stop-color="hsl(${(hue+45)%360},42%,35%)"/></linearGradient></defs><rect width="256" height="256" fill="url(#bg)"/><circle cx="${Math.floor(random()*256)}" cy="${Math.floor(random()*220)}" r="${40+Math.floor(random()*75)}" fill="#fff" opacity=".13"/><path d="M28 256Q30 173 108 169H148Q223 177 228 256" fill="hsl(${shirt},46%,43%)"/><path d="M110 150V181Q128 199 147 180V149" fill="${skin}"/><ellipse cx="128" cy="112" rx="${face}" ry="58" fill="${skin}"/>${pick(hairstyles)}<g fill="#292630"><ellipse cx="${128-eyes}" cy="109" rx="3.5" ry="4.5"/><ellipse cx="${128+eyes}" cy="109" rx="3.5" ry="4.5"/></g>${glasses}<path d="M126 114L122 129H130" fill="none" stroke="#805640" stroke-width="2" opacity=".6"/><path d="M112 140Q128 ${150+lift} 145 140" fill="none" stroke="#854e45" stroke-width="3" stroke-linecap="round"/><path d="M107 179L128 205L149 179" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="4"/></svg>`;
 // Fine texture makes compressed sizes/decoding less trivial than flat SVGs.
 const noise=Buffer.alloc(256*256*4);
 for(let i=0;i<noise.length;i+=4){noise[i]=noise[i+1]=noise[i+2]=Math.floor(random()*256);noise[i+3]=20;}
 return sharp(Buffer.from(svg)).composite([{input:noise,raw:{width:256,height:256,channels:4}}]).webp({quality:90}).toBuffer();
}
