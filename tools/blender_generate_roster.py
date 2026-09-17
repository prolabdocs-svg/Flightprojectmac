"""Build the canonical 70-airframe low-poly roster plus visible upgrade modules.

This uses the roster table in PROJECT_FLIGHT_AIRCRAFT_AND_UPGRADES_MASTER_SPEC_v2.0.md as
the source of truth. Every export uses metres, +Z forward, named semantic nodes, and a
mobile-safe, deliberately stylised material set. It is designed for Blender 5.2+.
"""
import bpy, os, re, math
from mathutils import Vector

ROOT = "/Users/sebastianpeimbert/Desktop/PROJECT FLIGHT"
SPEC = "/Users/sebastianpeimbert/Downloads/PROJECT_FLIGHT_AIRCRAFT_AND_UPGRADES_MASTER_SPEC_v2.0.md"
OUT = os.path.join(ROOT, "public/assets/models/airframes")
UPGRADE_OUT = os.path.join(ROOT, "public/assets/models/upgrades")
os.makedirs(OUT, exist_ok=True); os.makedirs(UPGRADE_OUT, exist_ok=True)

for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
for c in list(bpy.data.collections):
    if c.name != 'Collection': bpy.data.collections.remove(c)

def material(name, color, metal=0, rough=.6):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
    return m
PAINT=material('pf_paint',(0.08,.18,.27),.45,.36); FABRIC=material('pf_fabric',(.72,.62,.35),0,.92); METAL=material('pf_metal',(.13,.16,.17),.72,.3); RUBBER=material('pf_rubber',(.015,.015,.015),0,.9); GLASS=material('pf_glass',(.12,.34,.43),.12,.18); HI=material('pf_safety',(.95,.26,.03),0,.5); WHITE=material('pf_white',(.82,.83,.76),.05,.7)

def col(name):
    c=bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c); return c
def link(o,c):
    for old in list(o.users_collection): old.objects.unlink(o)
    c.objects.link(o); return o
def box(c,n,p,s,ma,bev=.0):
    bpy.ops.mesh.primitive_cube_add(location=p); o=bpy.context.object; o.name=n; o.scale=s; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); o.data.materials.append(ma)
    if bev: q=o.modifiers.new('bevel','BEVEL');q.width=bev;q.segments=1
    return link(o,c)
def cyl(c,n,p,r,d,ma,rot=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10,radius=r,depth=d,location=p);o=bpy.context.object;o.name=n;o.data.materials.append(ma)
    if rot:o.rotation_euler=rot
    return link(o,c)
def rod(c,n,a,b,r,ma):
    a,b=Vector(a),Vector(b);d=b-a;bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=r,depth=d.length,location=(a+b)/2);o=bpy.context.object;o.name=n;o.rotation_mode='QUATERNION';o.rotation_quaternion=d.to_track_quat('Z','Y');o.data.materials.append(ma);return link(o,c)
def wing(c,n,z,span,chord,ma,low=False):
    o=box(c,n,(0,0,z),(span/2,.06,chord/2),ma,.02); o.rotation_euler.y=(-.05 if low else .04); return o
def wheel(c,n,x,z,rad=.3):
    bpy.ops.mesh.primitive_torus_add(major_radius=rad,minor_radius=rad*.26,major_segments=12,minor_segments=6,location=(x,-.65,z),rotation=(math.pi/2,0,0));o=bpy.context.object;o.name=n;o.data.materials.append(RUBBER);link(o,c)
def prop(c,z,blades=2,r=.72):
    for i in range(blades):
        a=i*math.pi*2/blades; rod(c,'prop_blade',(-math.cos(a)*r,0,z),(math.cos(a)*r,0,z),.055,HI if blades>=4 else WHITE)
    cyl(c,'prop_hub',(0,0,z-.04),.13,.18,METAL,(math.pi/2,0,0))
def jet(c,x,z,scale=1):
    cyl(c,'turbofan', (x,0,z),.28*scale,.9*scale,METAL, (math.pi/2,0,0)); cyl(c,'engine_intake',(x,0,z+.47*scale),.2*scale,.02,GLASS,(math.pi/2,0,0))

def build_airframe(id_, name, role, tier):
    c=col('AIRFRAME__'+id_); is_heavy=tier>=8; is_jet=tier in (7,8,10); is_turbo=tier in (5,6,9); is_water=(id_.startswith('A2') or 'Amphib' in name or 'Otter' in name); twin=('Twin' in name or 'Baron' in name or 'Seneca' in name or 'Commander' in name or tier in (6,))
    scale = 1 + max(0,tier-3)*.22
    if is_heavy: scale *= 1.85
    fuselage_len=4.8*scale; fuselage_w=.48*scale
    # silhouette: exposed tube at T0, cabin body thereafter.
    if tier==0:
        for x in (-fuselage_w,fuselage_w): rod(c,'exposed_longeron',(x,0,-fuselage_len/2),(x,0,fuselage_len/2),.045*scale,METAL)
        for z in (-1.5*scale,-.4*scale,.7*scale): rod(c,'tube_cross',(-fuselage_w,0,z),(fuselage_w,0,z),.04*scale,METAL)
    else:
        box(c,'fuselage',(0,0,0),(fuselage_w,.48*scale,fuselage_len/2),PAINT,.12*scale)
        box(c,'canopy',(0,.43*scale,.35*scale),(fuselage_w*.77,.25*scale,1.05*scale),GLASS,.08*scale)
    span=(8+min(tier,7)*1.25)*scale; chord=(1.25+min(tier,6)*.08)*scale
    if is_jet: wing(c,'main_wing',0,span,chord,PAINT,low=True); wing(c,'horizontal_tail',-fuselage_len*.4,span*.35,chord*.48,PAINT,low=True)
    else: wing(c,'main_wing',.15*scale,span,chord,FABRIC if tier<=1 else PAINT); wing(c,'horizontal_tail',-fuselage_len*.42,span*.32,chord*.45,FABRIC if tier<=1 else PAINT)
    box(c,'vertical_tail',(0,.62*scale,-fuselage_len*.43),(.06*scale,.65*scale,.45*scale),PAINT,.02)
    # named control surfaces required by animation/damage system
    box(c,'aileron_L',(-span*.36,.02,.02),(span*.13,.04,chord*.15),PAINT,.01); box(c,'aileron_R',(span*.36,.02,.02),(span*.13,.04,chord*.15),PAINT,.01)
    box(c,'elevator',(0,.02,-fuselage_len*.47),(span*.15,.04,chord*.13),PAINT,.01); box(c,'rudder',(0,.73*scale,-fuselage_len*.62),(.04*scale,.34*scale,.14*scale),PAINT,.01)
    # propulsion variations
    if is_jet:
        engines=6 if 'Colossus' in name else (4 if is_heavy or 'Concord' in name else (3 if 'Falcon' in name else 2))
        for i in range(engines): jet(c,(i-(engines-1)/2)*span*.18, .18*scale, scale*(1.15 if is_heavy else 1))
    elif is_turbo or tier<=5:
        engines=4 if is_heavy else (2 if twin else 1)
        for i in range(engines):
            x=(i-(engines-1)/2)*span*.22; cyl(c,'engine_mount_'+str(i),(x,0,fuselage_len*.48),.3*scale,.62*scale,METAL,(math.pi/2,0,0)); prop(c,fuselage_len*.82 if engines==1 else .28*scale, 5 if is_turbo else 3, .6*scale)
    # gear / water option
    if is_water:
        for x in (-span*.18,span*.18): box(c,'float_'+str(x),(x,-.65*scale,.15*scale),(.42*scale,.25*scale,1.9*scale),WHITE,.12*scale)
        box(c,'water_rudder',(0,-.55*scale,-fuselage_len*.55),(.04,.2,.25),METAL)
    else:
        count=8 if is_heavy else 2
        for i in range(count):
            x=(i-(count-1)/2)*(span*.06 if is_heavy else span*.22); wheel(c,'wheel_'+str(i),x,fuselage_len*.18,.35*scale*(1.2 if tier>=5 else 1)); rod(c,'landing_strut_'+str(i),(x,-.62*scale,fuselage_len*.18),(x*.7,-.15*scale,.45*scale),.04*scale,METAL)
    # per-frame root contains metadata that the TypeScript loader can inspect.
    for o in c.objects: o['pf_airframe_id']=id_; o['pf_frame_name']=name; o['pf_role']=role; o['pf_tier']=tier
    bpy.ops.object.select_all(action='DESELECT')
    for o in c.objects:o.select_set(True)
    bpy.context.view_layer.objects.active=next(iter(c.objects))
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,id_.lower().replace('-','_')+'.glb'),export_format='GLB',use_selection=True,export_apply=True,export_materials='EXPORT')

def make_upgrade(id_, kind, base, accent=HI):
    c=col('UPGRADE__'+id_)
    if kind=='prop': prop(c,0,base,1)
    elif kind=='tire': wheel(c,'upgrade_tire',0,0,base)
    elif kind=='tank': box(c,'auxiliary_tank',(0,0,0),(base,.32,base*1.5),accent,.12)
    elif kind=='wing': wing(c,'upgrade_wing_device',0,base*4,base,accent); box(c,'slat', (0,.1,base*.55),(base*4,.035,.06),WHITE)
    elif kind=='avionics': box(c,'glass_cockpit',(0,0,0),(.45,.06,.28),GLASS,.03); box(c,'gps_screen',(0,.08,.02),(.22,.02,.16),WHITE,.01)
    elif kind=='gear':
        for x in (-base,base): wheel(c,'tundra_tire',x,0,base*.66); rod(c,'reinforced_strut',(x,0,0),(x*.5,.7,0),.07,METAL)
    elif kind=='float':
        for x in (-base,base): box(c,'amphib_float',(x,0,0),(base*.35,.26,base*1.7),WHITE,.14)
    elif kind=='cargo': box(c,'cargo_pod',(0,0,0),(.55,.38,1.4),PAINT,.16)
    elif kind=='winglet':
        for x in (-base,base): box(c,'winglet',(x,.45,0),(.04,.48,.2),accent,.02)
    for o in c.objects:o['pf_upgrade_id']=id_;o['pf_kind']=kind
    bpy.ops.object.select_all(action='DESELECT')
    for o in c.objects:o.select_set(True)
    bpy.context.view_layer.objects.active=next(iter(c.objects)); bpy.ops.export_scene.gltf(filepath=os.path.join(UPGRADE_OUT,id_+'.glb'),export_format='GLB',use_selection=True,export_apply=True,export_materials='EXPORT')

roster=[]
for line in open(SPEC,encoding='utf8'):
    m=re.match(r'\| `([^`]+)` \| \*\*([^*]+)\*\* \| [^|]+ \| ([^|]+) \|',line)
    if m:
        aid,name,role=m.groups(); tier=int(re.search(r'(\d+)',aid).group(1)) if re.search(r'(\d+)',aid) else 0; roster.append((aid,name,role,tier))
for row in roster: build_airframe(*row)

# Canonical physical upgrade families specified by sections 10–18 of the master spec.
for args in [
 ('prop_2_blade_climb','prop',2),('prop_2_blade_cruise','prop',2),('prop_3_blade','prop',3),('prop_5_blade_composite','prop',5),
 ('tire_narrow','tire',.22),('tire_standard','tire',.32),('tire_softfield','tire',.46),('tire_tundra','tire',.68),('tire_transport','tire',.52),
 ('tank_auxiliary','tank',.35),('tank_long_range','tank',.52),('slat_and_flap_kit','wing',.32),('vortex_generator_kit','wing',.18),
 ('glass_cockpit','avionics',.4),('gps_navigation','avionics',.3),('reinforced_bush_gear','gear',.55),('amphibious_float_set','float',.8),('cargo_pod','cargo',.5),('cruise_winglets','winglet',1.4)
]: make_upgrade(*args)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'project_flight_roster.blend'))
print('Exported',len(roster),'canonical airframes and 19 visible upgrade modules')
