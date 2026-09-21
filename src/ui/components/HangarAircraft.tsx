/** A lightweight hero render for menu surfaces. The flight scene owns the 3D aircraft;
 * this SVG keeps the hub polished while that scene is intentionally not mounted. */
export function HangarAircraft({ fabric, tube }: { fabric?: string; tube?: string } = {}) {
  return <svg className="hangar-aircraft" viewBox="0 0 620 300" aria-hidden="true">
    <defs><linearGradient id="fabric" x1="0" x2="0" y1="0" y2="1"><stop stopColor={fabric ?? "#e9d28e"}/><stop offset="1" stopColor={fabric ?? "#a87935"} stopOpacity={fabric ? 0.72 : 1}/></linearGradient><linearGradient id="metal" x1="0" x2="1"><stop stopColor="#d5d9d5"/><stop offset=".55" stopColor="#78837f"/><stop offset="1" stopColor="#e7e5d8"/></linearGradient><filter id="shadow"><feGaussianBlur stdDeviation="8"/></filter></defs>
    <ellipse cx="310" cy="253" rx="218" ry="18" fill="#020506" opacity=".42" filter="url(#shadow)"/>
    <g stroke={tube ?? "#303a39"} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M282 155 170 230M282 155 235 227M350 154 425 228M350 154 370 230"/>
      <path d="M264 140 312 222M358 141 312 222M270 166 345 166" strokeWidth="5" opacity=".8"/>
    </g>
    <path d="M87 126 272 107 465 128 272 151Z" fill="url(#fabric)" stroke="#293332" strokeWidth="4"/>
    <path d="M89 126 272 107 465 128" fill="none" stroke="#fff2b6" strokeWidth="3" opacity=".48"/>
    <path d="M255 115 367 119 393 160 242 160Z" fill="url(#metal)" stroke="#27302f" strokeWidth="5"/>
    <path d="M376 127 460 143 534 144 466 130Z" fill="#bdc7c2" stroke="#293332" strokeWidth="4"/>
    <path d="M445 145 532 147 548 161 455 160Z" fill="url(#fabric)" stroke="#293332" strokeWidth="4"/>
    <path d="M477 143 482 97 505 103 509 145" fill="url(#fabric)" stroke="#293332" strokeWidth="4"/>
    <ellipse cx="246" cy="157" rx="33" ry="26" fill="#668f98" opacity=".72" stroke="#d9eff1" strokeWidth="3"/>
    <g fill="#202526" stroke="#0d1211" strokeWidth="8"><circle cx="217" cy="231" r="19"/><circle cx="384" cy="232" r="19"/></g>
    <g fill="#f06a2a"><circle cx="170" cy="126" r="7"/><path d="m540 151 46-14-4 25Z"/></g>
    <g stroke="#f3d27e" strokeWidth="4" opacity=".7"><path d="M140 121 250 110M170 135 271 148M300 111l14 49M334 115l-3 45"/></g>
  </svg>;
}
