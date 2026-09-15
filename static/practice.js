(function(root) {
  const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const label=midi=>names[midi%12]+(Math.floor(midi/12)-1);
  function referenceAt(piece,tempo,octave=0) {
    const quarterSeconds=60/tempo*piece.denominator/4;
    return {title:piece.title,tempo,key_fifths:piece.key_fifths || 0,time_signature:{numerator:piece.numerator,denominator:piece.denominator},
      duration:piece.quarters*quarterSeconds, notes:piece.notes.map(n=>{
        const midi=n.midi+octave*12;
        return {midi,label:label(midi),name:names[midi%12],octave:Math.floor(midi/12)-1,
          start:n.quarterStart*quarterSeconds,notation_start:n.quarterStart*quarterSeconds,
          duration:n.quarterDuration*quarterSeconds,duration_beats:n.quarterDuration};
      })};
  }
  function compare(reference, played, allowanceMs=100) {
    const expected=reference.notes, actual=played.notes, pulse=60/reference.tempo;
    const n=expected.length,m=actual.length;
    const dp=Array.from({length:n+1},()=>Array(m+1).fill(Infinity));
    const path=Array.from({length:n+1},()=>Array(m+1));dp[0][0]=0;
    for(let i=0;i<=n;i++)for(let j=0;j<=m;j++) {
      const update=(a,b,c,kind)=>{if(c<dp[a][b]){dp[a][b]=c;path[a][b]=kind;}};
      if(i<n)update(i+1,j,dp[i][j]+1,'missed');
      if(j<m)update(i,j+1,dp[i][j]+1,'extra');
      if(i<n&&j<m) {
        const delta=Math.abs(actual[j].start-expected[i].start)/pulse;
        if(delta<=Math.max(.75,allowanceMs/1000/pulse))update(i+1,j+1,dp[i][j]+Math.min(delta,.9)+(actual[j].midi===expected[i].midi?0:.8),'match');
      }
    }
    const ref=Array(n), take=Array(m), rows=[];
    let i=n,j=m;
    while(i||j) {
      const kind=path[i][j];
      if(kind==='match') {
        i--;j--; const delta=Math.round((actual[j].start-expected[i].start)*1000);
        const wrong=actual[j].midi!==expected[i].midi, timing=Math.abs(delta)>allowanceMs;
        const status=wrong?'wrong':timing?'timing':'correct';
        ref[i]=take[j]=status;
        rows.push({expected:i,actual:j,status,delta,wrong,timing});
      } else if(kind==='missed') {i--;ref[i]='missed';rows.push({expected:i,status:'missed'});}
      else {j--;take[j]='extra';rows.push({actual:j,status:'extra'});}
    }
    rows.reverse();return {reference:ref,actual:take,rows,allowanceMs};
  }
  const api={referenceAt,compare,label,colors:{correct:'#39704c',timing:'#b27612',wrong:'#bd4038',missed:'#bd4038',extra:'#9b4399'}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Practice=api;
})(globalThis);
