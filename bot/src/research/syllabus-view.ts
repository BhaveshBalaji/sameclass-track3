export const SYLLABUS_EXTRACTION_LIMIT=100000;
export interface SyllabusCoverage {extractionLimit:number;extractedChars:number;extractionTruncated:boolean;excerptedForModel:boolean;documentUnchanged:true}

/** Select query-relevant passages from the extracted document, rather than only its beginning. */
export function syllabusView(value:unknown,question:string){
  const data=value as Record<string,unknown>,text=String(data.text??''),budget=16000;
  const provided=data.pages as {page:number|null;text:string}[]|undefined;
  const pages=provided?.length?provided:[{page:null,text}];
  const terms=[...new Set((question.toLowerCase().match(/[a-z]{4,}/g)??[])
    .filter(w=>!['what','about','syllabus','please','course','does','this','that','with'].includes(w)))];
  const focus=terms.length?terms:['grading','exam','assignment','schedule','topics','project'];
  const chunks=pages.flatMap(page=>Array.from({length:Math.ceil((page.text??'').length/1800)},(_,index)=>{
    const content=page.text.slice(index*1800,(index+1)*1800);
    return {page:page.page,text:content,score:focus.reduce((n,word)=>n+(content.toLowerCase().includes(word)?1:0),0)};
  }));
  const order=chunks.map((c,index)=>({...c,index})).sort((a,b)=>(b.index===0?100:b.score)-(a.index===0?100:a.score));
  const selected:typeof order=[];let used=0;
  for(const chunk of order){if(used>=budget)break;const content=chunk.text.slice(0,budget-used);selected.push({...chunk,text:content});used+=content.length;}
  selected.sort((a,b)=>a.index-b.index);
  const textCoverage:SyllabusCoverage={extractionLimit:Number(data.extractionLimit??SYLLABUS_EXTRACTION_LIMIT),extractedChars:text.length,
    extractionTruncated:Boolean(data.truncated),excerptedForModel:selected.length<chunks.length||selected.some(chunk=>chunk.text.length<chunks[chunk.index]!.text.length),documentUnchanged:true};
  return {...data,text:undefined,download_url:undefined,pages:selected.map(({page,text})=>({page,text})),textCoverage,
    coverageExplanation:'These limits apply to text Ray reads. The original syllabus/PDF is unchanged; omitted excerpts are not proof that document sections are missing.'};
}
