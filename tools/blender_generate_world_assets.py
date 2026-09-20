"""PROJECT FLIGHT World Asset Kit — derived from the World/Terrain master spec v2.

Exports low-poly, mobile-friendly GLB prefabs. Names intentionally mirror the World spec:
rural kit (sec. 86), roads/bridges/power (79–82), landmarks (89–91), quarry (105),
coast/port (110) and mission/navigation assets. Units are metres; meshes are originals.
"""
import bpy, os, math
from mathutils import Vector
ROOT='/Users/sebastianpeimbert/Desktop/PROJECT FLIGHT'; OUT=ROOT+'/public/assets/models/world'; os.makedirs(OUT,exist_ok=True)
for o in list(bpy.data.objects): bpy.data.objects.remove(o,do_unlink=True)
def M(n,c,metal=0,rough=.7):
 m=bpy.data.materials.get(n) or bpy.data.materials.new(n);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;return m
WOOD=M('wood',(.25,.08,.025)); RUST=M('rust',(.4,.08,.015),.25); STEEL=M('steel',(.28,.32,.31),.75,.35); CONC=M('concrete',(.33,.32,.28)); LEAF=M('leaf',(.06,.25,.07)); GLASS=M('glass',(.06,.25,.32),.1,.18); HI=M('safety_orange',(.95,.22,.02)); SAND=M('sand',(.5,.36,.17)); WATER=M('water',(.04,.22,.3),.3,.15)
def C(n):c=bpy.data.collections.new(n);bpy.context.scene.collection.children.link(c);return c
def L(o,c):
 for x in list(o.users_collection):x.objects.unlink(o)
 c.objects.link(o);return o
def B(c,n,p,s,m,b=.0):
 bpy.ops.mesh.primitive_cube_add(location=p);o=bpy.context.object;o.name=n;o.scale=s;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 if b:q=o.modifiers.new('bevel','BEVEL');q.width=b;q.segments=1
 return L(o,c)
def Y(c,n,p,r,d,m,rot=None):
 bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=r,depth=d,location=p);o=bpy.context.object;o.name=n;o.data.materials.append(m)
 if rot:o.rotation_euler=rot
 return L(o,c)
def R(c,n,a,b,r,m):
 a,b=Vector(a),Vector(b);d=b-a;bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=r,depth=d.length,location=(a+b)/2);o=bpy.context.object;o.name=n;o.rotation_mode='QUATERNION';o.rotation_quaternion=d.to_track_quat('Z','Y');o.data.materials.append(m);return L(o,c)
def E(c,n):
 bpy.ops.object.select_all(action='DESELECT')
 for o in c.objects:o.select_set(True);o['pf_asset_id']=n
 bpy.context.view_layer.objects.active=next(iter(c.objects));bpy.ops.export_scene.gltf(filepath=f'{OUT}/{n}.glb',export_format='GLB',use_selection=True,export_apply=True,export_materials='EXPORT')
def house(n,roof=RUST):
 c=C(n);B(c,'building_shell',(0,1.7,0),(2.8,1.7,2.25),WOOD,.08)
 for sign in (-1,1):o=B(c,'roof',(0,3.8,sign*1.05),(3.12,.14,1.7),roof,.03);o.rotation_euler.x=sign*.55
 B(c,'door',(0,.9,2.27),(.65,.9,.03),STEEL);E(c,n)
def shed(n):
 c=C(n);B(c,'shed_body',(0,1.25,0),(2.2,1.25,2.8),STEEL,.06);B(c,'open_door',(0,1.1,2.83),(1.25,1.1,.03),GLASS);o=B(c,'shed_roof',(0,2.65,0),(2.5,.12,3.05),RUST,.04);o.rotation_euler.x=.08;E(c,n)
def tree(n,kind='tree'):
 c=C(n);Y(c,'trunk',(0,1,0),.18,2,WOOD)
 if kind=='palm':
  for i in range(7):R(c,'palm_frond',(0,3.8,0),(math.cos(i*.9)*2.0,3.45,math.sin(i*.9)*2.0),.08,LEAF)
 else:
  bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=1.7,radius2=.2,depth=5,location=(0,4.2,0));o=bpy.context.object;o.name='canopy';o.data.materials.append(LEAF);L(o,c)
 E(c,n)
def bridge(n):
 c=C(n);B(c,'bridge_deck',(0,1.4,0),(4.2,.18,10),CONC,.04)
 for x in (-3.8,3.8):
  R(c,'truss',(x,1.7,-9),(x,4,0),.09,STEEL);R(c,'truss',(x,4,0),(x,1.7,9),.09,STEEL);R(c,'rail',(x,3.7,-10),(x,3.7,10),.06,STEEL)
 E(c,n)
def tower(n):
 c=C(n);Y(c,'tower_leg',(0,6,0),.12,12,STEEL)
 for z in (3,6,9):
  R(c,'crossarm',(-2,z,0),(2,z,0),.1,STEEL)
 for i in range(3):Y(c,'antenna',(0,12.5+i*.75,0),.04,1.5,STEEL)
 E(c,n)
def quarry(n):
 c=C(n)
 for i in range(4):
  B(c,'quarry_bench',(0,-i*.65,0),(14-i*2,.45,12-i*1.7),SAND,.08)
 R(c,'haul_road',(-14,.25,-10),(10,-1.7,8),1.4,CONC);shed='quarry_shed';B(c,shed,(12,1.2,-7),(2.5,1.2,2),STEEL,.05);E(c,n)
def port(n):
 c=C(n);B(c,'pier',(0,.25,0),(4,.25,15),WOOD,.03);Y(c,'beacon',(0,2.1,12),.22,3.7,HI);B(c,'warehouse',(10,2.5,-2),(5,2.5,6),STEEL,.09)
 for i in range(4):B(c,'cargo_container',(8+(i%2)*2.4,.8,7+(i//2)*3),(1.1,.8,1.4),RUST if i%2 else STEEL,.03)
 E(c,n)
def runway(n):
 c=C(n);B(c,'runway_segment',(0,.04,0),(10,.04,70),CONC)
 for z in range(-55,56,20):B(c,'centerline',(0,.09,z),(.22,.02,4),SAND)
 B(c,'threshold', (0,.09,-64),(8,.02,1.2),SAND);E(c,n)
def hangar_compound(n):
 c=C(n); W,D,H=18.0,14.0,9.0; ridge_h=H+2.2; overhang=.6
 slope_run=D/2; slope_ang=math.atan2(ridge_h-H,slope_run); slope_len=math.hypot(slope_run,ridge_h-H)
 for fx in (-W/2+.3,-W/6,W/6,W/2-.3):
  Y(c,'frame_post_front',(fx,H/2,D/2-.15),.18,H,STEEL);Y(c,'frame_post_back',(fx,H/2,-D/2+.15),.18,H,STEEL)
 B(c,'back_wall',(0,H/2,-D/2),(W/2,H/2,.08),STEEL)
 for sx in (-1,1):B(c,'side_wall',(sx*W/2,H/2,0),(.08,H/2,D/2),STEEL)
 for sign in (-1,1):
  o=B(c,'roof_panel',(0,(H+ridge_h)/2,sign*D/4),(W/2+overhang,.1,slope_len/2),RUST,b=.02);o.rotation_euler.x=sign*slope_ang
 B(c,'ridge_cap',(0,ridge_h-.05,0),(W/2+.3,.1,.32),STEEL)
 doorH,doorW=H*.78,W*.22
 for sx in (-1,1):
  doorx=sx*(W/2-doorW*.5-.1)
  B(c,'sliding_door',(doorx,doorH/2,D/2-.1),(doorW/2,doorH/2,.05),CONC,b=.01)
  Y(c,'door_track',(doorx,doorH+.1,D/2-.1),.05,doorW+.2,STEEL,rot=(0,0,math.pi/2))
 B(c,'floor_slab',(0,.02,0),(W/2-.1,.02,D/2-.1),CONC)
 fx,fz=W/2+4.2,D/2-1.0
 Y(c,'fuel_tank',(fx,1.15,fz),1.0,3.2,STEEL,rot=(0,0,math.pi/2))
 Y(c,'fuel_cradle_a',(fx-1.15,.45,fz),.06,.9,STEEL);Y(c,'fuel_cradle_b',(fx+1.15,.45,fz),.06,.9,STEEL)
 B(c,'fuel_bowser',(fx,.5,fz+2.4),(.5,.5,.7),HI,b=.03)
 px,pz=W/2+7.5,-D/2+1.5
 Y(c,'sock_pole',(px,3,pz),.08,6,STEEL)
 bpy.ops.mesh.primitive_cone_add(vertices=10,radius1=.4,radius2=.14,depth=2.6,location=(px+1.4,5.5,pz),rotation=(0,math.pi/2,0));o=bpy.context.object;o.name='windsock';o.data.materials.append(HI);L(o,c)
 B(c,'workbench',(-W/4,.55,-D/2+1.1),(1.6,.55,.5),WOOD,b=.03)
 B(c,'tool_cabinet',(W/4-1,.9,-D/2+.7),(.6,.9,.4),STEEL,b=.02)
 E(c,n)

def landmark(n,shape):
 c=C(n)
 if shape=='dam':
  B(c,'dam_wall',(0,6,0),(15,6,1.1),CONC,.08);B(c,'spillway',(0,8,0),(4,.1,1.25),STEEL);B(c,'reservoir',(0,.02,-22),(35,.02,20),WATER)
 elif shape=='windmill':
  Y(c,'windmill_tower',(0,6,0),.25,12,STEEL);R(c,'blade_a',(-3,12,0),(3,12,0),.12,HI);R(c,'blade_b',(0,9,0),(0,15,0),.12,HI)
 elif shape=='volcano':
  bpy.ops.mesh.primitive_cone_add(vertices=16,radius1=20,radius2=5,depth=22,location=(0,11,0));o=bpy.context.object;o.name='volcanic_cone';o.data.materials.append(SAND);L(o,c);Y(c,'crater',(0,22,0),5,.6,RUST)
 elif shape=='cliff':
  for i in range(4):B(c,'cliff_stack',(i*3,3+i%2,0),(2.1,3+i%2,6),SAND,.16)
 E(c,n)

for n in ('farmhouse_a','farmhouse_b'):house(n, RUST if n.endswith('a') else STEEL)
for n in ('barn_a','barn_b','small_workshop'):shed(n)
for n in ('conifer_tree','dry_scrub_tree','riparian_tree'):tree(n)
tree('coastal_palm','palm')
for n in ('road_bridge_small','river_truss_bridge'):bridge(n)
for n in ('radio_tower','powerline_tower','water_tower'):tower(n)
quarry('stepped_quarry');port('coastal_port');runway('runway_modular_segment')
hangar_compound('field_hangar_compound')
for n,s in (('reservoir_dam','dam'),('windmill_landmark','windmill'),('volcanic_cone_landmark','volcano'),('coastal_cliff_landmark','cliff')):landmark(n,s)

def hangar_hero(n):
 """Hero agricultural hangar for the_field's first-minute view: open structure,
 visible roof trusses, retracted sliding doors, fuel drums and a sign."""
 c=C(n); W,D,H=22.0,16.0,10.0; ridge_h=H+3.0; overhang=.8
 slope_run=D/2; slope_ang=math.atan2(ridge_h-H,slope_run); slope_len=math.hypot(slope_run,ridge_h-H)
 for fx in (-W/2+.3,-W/6,W/6,W/2-.3):
  Y(c,'frame_post_front',(fx,H/2,D/2-.15),.2,H,STEEL);Y(c,'frame_post_back',(fx,H/2,-D/2+.15),.2,H,STEEL)
  R(c,'truss_brace',(fx,H-.3,D/2-.15),(fx,H+1.6,0),.08,STEEL)
 B(c,'back_wall',(0,H/2,-D/2),(W/2,H/2,.08),STEEL)
 for sx in (-1,1):B(c,'side_wall',(sx*W/2,H/2,0),(.08,H/2,D/2),STEEL)
 for sign in (-1,1):
  o=B(c,'roof_panel',(0,(H+ridge_h)/2,sign*D/4),(W/2+overhang,.12,slope_len/2),RUST,b=.03);o.rotation_euler.x=sign*slope_ang
 B(c,'ridge_cap',(0,ridge_h-.05,0),(W/2+.4,.12,.36),STEEL)
 doorH,doorW=H*.82,W*.24
 for sx,off in ((-1,.15),(1,.62)):
  doorx=sx*(W/2-doorW*.5-.1)*off
  B(c,'sliding_door',(doorx,doorH/2,D/2-.15),(doorW/2,doorH/2,.05),CONC,b=.02)
  Y(c,'door_track',(doorx,doorH+.15,D/2-.15),.06,doorW+.3,STEEL,rot=(0,0,math.pi/2))
 B(c,'floor_slab',(0,.02,0),(W/2-.1,.02,D/2-.1),CONC)
 fx,fz=W/2+3.2,D/2-2.2
 for i,dx in enumerate((0,1.1,2.2)):
  Y(c,f'fuel_drum_{i}',(fx+dx,.55,fz),.42,1.1,RUST if i%2 else STEEL)
 sx0,sz0=-(W/2+3.5),D/2+1.0
 Y(c,'sign_post',(sx0,1.6,sz0),.08,3.2,WOOD)
 B(c,'sign_board',(sx0,3.0,sz0),(1.4,.55,.05),HI,b=.02)
 Y(c,'sock_pole',(W/2+7.5,3,-D/2+2),.08,6,STEEL)
 bpy.ops.mesh.primitive_cone_add(vertices=10,radius1=.4,radius2=.14,depth=2.6,location=(W/2+8.9,5.5,-D/2+2),rotation=(0,math.pi/2,0));o=bpy.context.object;o.name='windsock';o.data.materials.append(HI);L(o,c)
 E(c,n)

def village_cluster(n):
 """Compact ~100m block: 7 varied houses, a barn anchor, internal streets, trees
 and a perimeter fence, so the_field's settlement reads as a núcleo, not a hut."""
 c=C(n)
 house_specs=[(-30,-18,0,RUST),(-14,-22,.3,STEEL),(2,-20,-.2,RUST),(18,-24,.15,STEEL),(-24,4,-.4,RUST),(-6,8,.2,STEEL),(12,6,-.1,RUST)]
 for i,(hx,hz,rot,roof) in enumerate(house_specs):
  B(c,f'house_{i}_wall',(hx,1.6,hz),(2.6,1.6,2.1),WOOD,.06)
  for sign in (-1,1):
   o=B(c,f'house_{i}_roof',(hx,3.55,hz+sign*.05),(2.9,.13,1.6),roof,.02);o.rotation_euler.x=sign*.55;o.rotation_euler.y=rot
 B(c,'village_barn_wall',(20,3.0,-2),(6.4,3.0,7.5),RUST,.07)
 for sign in (-1,1):
  o=B(c,'village_barn_roof',(20,6.7,-2+sign*.1),(7.0,.18,8.0),STEEL,.03);o.rotation_euler.x=sign*.5
 B(c,'street_main',(-6,.03,-8),(24,.03,2.2),SAND)
 B(c,'street_cross',(-6,.03,4),(2.2,.03,26),SAND)
 for i,(tx,tz) in enumerate([(-38,-4),(30,10),(-2,16),(-34,14),(28,-14)]):
  Y(c,f'village_tree_trunk_{i}',(tx,1,tz),.16,2,WOOD)
  bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=1.5,radius2=.15,depth=4.4,location=(tx,4,tz));o=bpy.context.object;o.name=f'village_tree_canopy_{i}';o.data.materials.append(LEAF);L(o,c)
 for i,fx in enumerate(range(-42,42,6)):
  Y(c,f'village_fence_{i}',(fx,.6,-30),.07,1.2,WOOD)
 E(c,n)

def road_segment(n):
 """80m dirt access road tile: crowned bed, shallow drainage cunetas, fence posts
 and rails, meant to be repeated along a route via layoutRoadTiles."""
 c=C(n); length=80.0
 B(c,'road_bed',(0,.03,0),(3.2,.03,length/2),SAND)
 for sx in (-1,1):
  B(c,'road_ditch',(sx*4.4,-.05,0),(1.1,.12,length/2),SAND,.02)
 for sx in (-1,1):
  for i,zz in enumerate(range(int(-length/2)+4,int(length/2),8)):
   Y(c,f'road_post_{sx}_{i}',(sx*5.6,.6,zz),.07,1.2,WOOD)
   if i%2==0:R(c,f'road_rail_{sx}_{i}',(sx*5.6,1.0,zz),(sx*5.6,1.0,zz+8),.05,WOOD)
 E(c,n)

hangar_hero('field_hangar_hero'); village_cluster('field_village_cluster'); road_segment('field_road_segment')
# Gameplay/navigation props
for n in ('fence_post','utility_pole','airfield_windsock','checkpoint_beacon','emergency_strip_marker'):
 c=C(n)
 if n=='fence_post':Y(c,'post',(0,.8,0),.08,1.6,WOOD)
 elif n=='utility_pole':Y(c,'pole',(0,4,0),.13,8,WOOD);R(c,'crossbar',(-1.5,7.1,0),(1.5,7.1,0),.08,WOOD)
 elif n=='airfield_windsock':Y(c,'pole',(0,3,0),.08,6,STEEL); bpy.ops.mesh.primitive_cone_add(vertices=10,radius1=.38,radius2=.14,depth=3,location=(1.5,5.6,0),rotation=(0,math.pi/2,0));o=bpy.context.object;o.name='windsock';o.data.materials.append(HI);L(o,c)
 elif n=='checkpoint_beacon':Y(c,'beacon',(0,2,0),.22,4,HI);Y(c,'light',(0,4.1,0),.38,.15,GLASS)
 else:B(c,'marker',(0,.12,0),(2,.12,.6),HI,.04)
 E(c,n)
ROCK=M('rock',(.42,.36,.32),.05,.85); CACTUS=M('cactus',(.18,.38,.16))

def _rockpile(c,cx,cz,n,seed=0):
 for i in range(n):
  ang=(i/ n)*6.283+seed; rad=2+ (i%3)*1.4
  x,z=cx+math.cos(ang)*rad,cz+math.sin(ang)*rad
  h=.9+(i%4)*.5
  o=B(c,f'rock_{cx:.0f}_{cz:.0f}_{i}',(x,h/2,z),(1.1+(i%2)*.4,h/2,1.0+(i%3)*.3),ROCK,.15)
  o.rotation_euler.y=ang

def hero_scrap_valley_yard(n):
 """Region 2 hero: cantera bench, salvage crane, scrap piles and a steel yard shed —
 60x90m footprint, ground-origin, reads as a working deshuesadero from the air."""
 c=C(n)
 for i in range(3):
  B(c,'quarry_bench',(-10,-i*.6,-i*8),(30-i*4,.4,14-i*3),SAND,.1)
 Y(c,'crane_tower',(20,7,10),.5,14,STEEL); R(c,'crane_boom',(20,13.6,10),(20+22,15.4,10),.35,STEEL); R(c,'crane_cable',(38,15,10),(38,4,10),.06,STEEL)
 B(c,'crane_counterweight',(20-3,13,10),(1.1,.7,1.1),RUST,.05)
 for i in range(6):
  x,z=-22+(i%3)*7,-6+(i//3)*9
  o=B(c,f'scrap_pile_{i}',(x,1.1+i%2*.4,z),(1.6+i%2*.5,1.1+i%2*.4,1.9),RUST if i%2 else STEEL,.1)
  o.rotation_euler.z=(.15*i)%1
 B(c,'yard_shed_body',(28,2.1,-14),(4.6,2.1,3.4),STEEL,.06); B(c,'yard_shed_door',(28,1.6,-10.6),(2.2,1.6,.04),GLASS)
 o=B(c,'yard_shed_roof',(28,4.3,-14),(5.0,.14,3.7),RUST,.03);o.rotation_euler.x=.08
 R(c,'haul_road',(-40,.25,-28),(30,-.6,20),1.6,CONC)
 for i,fx in enumerate(range(-30,32,8)):
  Y(c,f'yard_fence_{i}',(fx,.7,-30),.07,1.4,STEEL)
 E(c,n)

def hero_red_canyon_outpost(n):
 """Region 3 hero: layered mesa, ranger caseta, switchback sendero, rock scatter —
 70x100m footprint reading as a canyon outpost perched on the mesa rim."""
 c=C(n)
 top_y=0.0
 for i in range(5):
  top_y=i*2.2; B(c,'mesa_layer',(0,top_y,0),(26-i*4,1.2,26-i*4),SAND,.2)
 B(c,'caseta_wall',(0,top_y+2.2,0),(2.4,1.6,2.0),RUST,.06)
 o=B(c,'caseta_roof',(0,top_y+4.0,0),(2.9,.14,2.4),STEEL,.03);o.rotation_euler.x=.05
 pts=[(10,-10),(18,-4),(24,4),(30,14),(34,26)]
 for j,(px,pz) in enumerate(pts):
  B(c,f'sendero_{j}',(px,.06+j*.4,pz),(2.2,.04,3.2),SAND)
 _rockpile(c,-16,14,7,seed=1.1); _rockpile(c,20,-16,5,seed=2.3)
 E(c,n)

def hero_backcountry_lakeside(n):
 """Region 4 hero: two lakeside cabins, timber muelle, conifer treeline and shore —
 80x90m footprint, water plane anchors the lake edge."""
 c=C(n)
 B(c,'shore_water',(0,.02,40),(45,.02,30),WATER)
 for hx,hz in ((-20,-8),(-4,-14)):
  B(c,f'cabin_wall_{hx}',(hx,1.5,hz),(2.4,1.5,2.0),WOOD,.06)
  o=B(c,f'cabin_roof_{hx}',(hx,3.3,hz),(2.8,.13,2.4),RUST,.03);o.rotation_euler.x=.1
 B(c,'pier_deck',(10,.3,18),(3.2,.25,16),WOOD,.03)
 for i,pz in enumerate(range(4,32,6)):
  Y(c,f'pier_pile_{i}',(10-2.8,.15,pz),.18,1.2,WOOD);Y(c,f'pier_pile_r_{i}',(10+2.8,.15,pz),.18,1.2,WOOD)
 for i,(tx,tz) in enumerate([(-30,10),(-26,-14),(-2,4),(20,-16),(-14,20),(6,-20)]):
  Y(c,f'lake_tree_trunk_{i}',(tx,1.4,tz),.2,2.8,WOOD)
  bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=2.0,radius2=.2,depth=6,location=(tx,5.2,tz));o=bpy.context.object;o.name=f'lake_tree_canopy_{i}';o.data.materials.append(LEAF);L(o,c)
 E(c,n)

def hero_coast_run_port_town(n):
 """Region 5 hero: fishing pier, two warehouses, coastal houses and a palm row —
 90x110m footprint, the same authored port-town silhouette used for coast_run."""
 c=C(n)
 B(c,'town_pier',(0,.25,0),(4.2,.25,26),WOOD,.03); Y(c,'town_beacon',(0,2.4,24),.24,4.2,HI)
 B(c,'warehouse_a',(16,3.0,-8),(6.5,3.0,7.5),STEEL,.08); B(c,'warehouse_b',(30,2.6,4),(5.5,2.6,6.5),RUST,.08)
 for i in range(5):
  B(c,f'town_container_{i}',(18+(i%3)*2.6,.8,-16+(i//3)*3),(1.1,.8,1.4),RUST if i%2 else STEEL,.03)
 for i,(hx,hz) in enumerate([(-18,-6),(-24,4),(-16,14)]):
  B(c,f'coast_house_wall_{i}',(hx,1.5,hz),(2.4,1.5,2.0),SAND,.06)
  o=B(c,f'coast_house_roof_{i}',(hx,3.3,hz),(2.8,.13,2.4),RUST,.03);o.rotation_euler.x=.1
 for i,(px,pz) in enumerate([(-30,-14),(-34,0),(-30,16),(-24,-20)]):
  Y(c,f'town_palm_trunk_{i}',(px,1.8,pz),.2,3.6,WOOD)
  for k in range(6):
   R(c,f'town_palm_frond_{i}_{k}',(px,3.6+3.6,pz),(px+math.cos(k*1.05)*2.2,3.3+3.6,pz+math.sin(k*1.05)*2.2),.08,LEAF)
 E(c,n)

def hero_industrial_belt_district(n):
 """Region 6 hero: two production naves, tank farm, a chimney and a service road —
 90x100m footprint reading as a precision industrial corridor from altitude."""
 c=C(n)
 for i,nx in enumerate((-18,14)):
  B(c,f'nave_wall_{i}',(nx,3.4,0),(7.5,3.4,10),STEEL,.07)
  o=B(c,f'nave_roof_{i}',(nx,7.1,0),(8.0,.14,10.6),RUST,.03);o.rotation_euler.x=.04
 for i,(tx,tz) in enumerate([(36,-6),(41,-6),(46,-6)]):
  Y(c,f'tank_{i}',(tx,3.0,tz),2.2,6.0,STEEL)
 Y(c,'chimney',(36,12,6),1.1,24,CONC); B(c,'chimney_cap',(36,24.2,6),(1.3,.25,1.3),RUST,.02)
 R(c,'service_road',(-40,.05,-24),(40,-1.3,24),2.2,CONC)
 for i,fx in enumerate(range(-38,40,10)):
  Y(c,f'belt_pole_{i}',(fx,4,-30),.13,8,STEEL)
 E(c,n)

def hero_high_desert_station(n):
 """Region 7 hero: salt-flat test station, hangar, antenna mast and desert scatter —
 80x100m footprint reading as an isolated speed-record outpost on the salina."""
 c=C(n)
 B(c,'station_wall',(0,2.6,0),(6.0,2.6,5.0),CONC,.07); o=B(c,'station_roof',(0,5.5,0),(6.4,.14,5.4),STEEL,.03);o.rotation_euler.x=.03
 B(c,'test_hangar_wall',(24,3.4,-4),(7.0,3.4,6.5),STEEL,.08); o=B(c,'test_hangar_roof',(24,7.1,-4),(7.5,.14,7.0),RUST,.03);o.rotation_euler.x=.05
 Y(c,'antenna_mast',(-2,10,16),.16,20,STEEL)
 for z in (5,10,15):
  R(c,'antenna_guy',(-2,z,16),(8,.1,16),.05,STEEL)
 for i,(cx,cz) in enumerate([(-18,-10),(-24,4),(-12,14),(-30,-4)]):
  Y(c,f'cactus_trunk_{i}',(cx,1.4,cz),.35,2.8,CACTUS)
  for k in (-1,1):
   R(c,f'cactus_arm_{i}_{k}',(cx,2.2,cz),(cx+k*.9,3.0,cz),.2,CACTUS)
 _rockpile(c,14,18,5,seed=.4)
 E(c,n)

def hero_range_mountain_refuge(n):
 """Region 8 hero (campaign finale approach): stone refuge, fire lookout tower,
 conifer stand and rock outcrop — 70x90m footprint on the high mountain range."""
 c=C(n)
 B(c,'refuge_wall',(0,2.0,0),(3.6,2.0,3.0),ROCK,.08); o=B(c,'refuge_roof',(0,4.3,0),(4.0,.16,3.4),RUST,.03);o.rotation_euler.x=.12
 for lx in (-14,14):
  Y(c,'lookout_leg',(lx,7,10),.16,14,STEEL)
 B(c,'lookout_cabin',(0,15,10),(4.2,1.4,4.2),WOOD,.05)
 for i,(tx,tz) in enumerate([(-24,-10),(-18,-22),(-6,-16),(10,-24),(20,-12),(-30,8),(24,10)]):
  Y(c,f'refuge_tree_trunk_{i}',(tx,1.6,tz),.22,3.2,WOOD)
  bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=2.1,radius2=.2,depth=6.6,location=(tx,6.0,tz));o=bpy.context.object;o.name=f'refuge_tree_canopy_{i}';o.data.materials.append(LEAF);L(o,c)
 _rockpile(c,16,-4,6,seed=.9)
 E(c,n)

hero_scrap_valley_yard('pf_scrap_valley_yard')
hero_red_canyon_outpost('pf_red_canyon_outpost')
hero_backcountry_lakeside('pf_backcountry_lakeside')
hero_coast_run_port_town('pf_coast_run_port_town')
hero_industrial_belt_district('pf_industrial_belt_district')
hero_high_desert_station('pf_high_desert_station')
hero_range_mountain_refuge('pf_range_mountain_refuge')

bpy.ops.wm.save_as_mainfile(filepath=f'{OUT}/project_flight_world_assets.blend')
print('World kit exported:',len([p for p in os.listdir(OUT) if p.endswith('.glb')]),'GLB prefabs')
