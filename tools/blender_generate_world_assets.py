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
for n,s in (('reservoir_dam','dam'),('windmill_landmark','windmill'),('volcanic_cone_landmark','volcano'),('coastal_cliff_landmark','cliff')):landmark(n,s)
# Gameplay/navigation props
for n in ('fence_post','utility_pole','airfield_windsock','checkpoint_beacon','emergency_strip_marker'):
 c=C(n)
 if n=='fence_post':Y(c,'post',(0,.8,0),.08,1.6,WOOD)
 elif n=='utility_pole':Y(c,'pole',(0,4,0),.13,8,WOOD);R(c,'crossbar',(-1.5,7.1,0),(1.5,7.1,0),.08,WOOD)
 elif n=='airfield_windsock':Y(c,'pole',(0,3,0),.08,6,STEEL); bpy.ops.mesh.primitive_cone_add(vertices=10,radius1=.38,radius2=.14,depth=3,location=(1.5,5.6,0),rotation=(0,math.pi/2,0));o=bpy.context.object;o.name='windsock';o.data.materials.append(HI);L(o,c)
 elif n=='checkpoint_beacon':Y(c,'beacon',(0,2,0),.22,4,HI);Y(c,'light',(0,4.1,0),.38,.15,GLASS)
 else:B(c,'marker',(0,.12,0),(2,.12,.6),HI,.04)
 E(c,n)
bpy.ops.wm.save_as_mainfile(filepath=f'{OUT}/project_flight_world_assets.blend')
print('World kit exported:',len([p for p in os.listdir(OUT) if p.endswith('.glb')]),'GLB prefabs')
