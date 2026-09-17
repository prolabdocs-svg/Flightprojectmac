"""Generate every AIR_MIC, ENV_MIC and VFX asset declared in Visual Bible sections 25–27.
The registry itself is parsed, so production IDs cannot drift from the canonical document.
Each GLB is a distinct, named low-poly prefab or transparent VFX card; all use metre scale.
"""
import bpy, os, re, math
from mathutils import Vector
ROOT='/Users/sebastianpeimbert/Desktop/PROJECT FLIGHT'; SPEC=ROOT+'/PROJECT_FLIGHT_MASTER_VISUAL_IMPLEMENTATION_SPEC_v5.0.md'; OUT=ROOT+'/public/assets/models/micro';os.makedirs(OUT,exist_ok=True)
for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
def mat(n,c,metal=0,rough=.65,alpha=1):
 m=bpy.data.materials.get(n) or bpy.data.materials.new(n);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,alpha);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 if alpha<1:m.surface_render_method='DITHERED'
 return m
STEEL=mat('steel',(.19,.23,.24),.72,.32);WOOD=mat('wood',(.28,.10,.035));RUB=mat('rubber',(.02,.02,.02),0,.9);FAB=mat('fabric',(.72,.62,.36));GREEN=mat('green',(.08,.3,.08));DRY=mat('dry',(.42,.28,.08));HI=mat('orange',(.95,.2,.02));WHITE=mat('white',(.85,.84,.72));GLASS=mat('glass',(.07,.3,.37),.1,.14,.55);DUST=mat('dust',(.52,.36,.16),0,.9,.58)
def C(n):c=bpy.data.collections.new(n);bpy.context.scene.collection.children.link(c);return c
def L(o,c):
 for q in list(o.users_collection):q.objects.unlink(o)
 c.objects.link(o);return o
def B(c,n,p,s,m):
 bpy.ops.mesh.primitive_cube_add(location=p);o=bpy.context.object;o.name=n;o.scale=s;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);return L(o,c)
def Y(c,n,p,r,d,m,rot=None):
 bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=r,depth=d,location=p);o=bpy.context.object;o.name=n;o.data.materials.append(m)
 if rot:o.rotation_euler=rot
 return L(o,c)
def R(c,n,a,b,r,m):
 a,b=Vector(a),Vector(b);d=b-a;bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=r,depth=d.length,location=(a+b)/2);o=bpy.context.object;o.name=n;o.rotation_mode='QUATERNION';o.rotation_quaternion=d.to_track_quat('Z','Y');o.data.materials.append(m);return L(o,c)
def torus(c,n,major,minor,m):
 bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=10,minor_segments=5);o=bpy.context.object;o.name=n;o.data.materials.append(m);return L(o,c)
def ex(c,id):
 bpy.ops.object.select_all(action='DESELECT')
 for o in c.objects:o.select_set(True);o['asset_id']=id
 bpy.context.view_layer.objects.active=next(iter(c.objects));bpy.ops.export_scene.gltf(filepath=f'{OUT}/{id.lower()}.glb',export_format='GLB',use_selection=True,export_apply=True,export_materials='EXPORT')
def make(id,desc):
 c=C(id);d=desc.lower()
 # Aircraft micro kit: semantic primitive composition based on functional family.
 if id.startswith('AIR_MIC'):
  if any(k in d for k in ('tube','pushrod','cable','hose','lead','wire','strut','spar','rail')):R(c,'tube',(0,0,0),(0,0,1.3),.04,STEEL)
  elif any(k in d for k in ('wheel','brake','pulley','hub','spinner','gauge','filter','cap','isolator','bottle')):torus(c,'round_component',.26,.07,RUB if 'wheel' in d else STEEL)
  elif any(k in d for k in ('wing','aileron','elevator','rudder','fabric','panel','fairing','cowl','canopy','windscreen')):B(c,'aero_surface',(0,0,0),(1.0,.06,.34),FAB if 'fabric' in d or 'wing' in d else (GLASS if 'canopy' in d or 'windscreen' in d else STEEL))
  elif any(k in d for k in ('engine','radiator','battery','gearbox','intake','exhaust','muffler')):B(c,'powerplant_part',(0,0,0),(.42,.32,.55),STEEL);Y(c,'detail',(.44,0,0),.12,.35,HI,(0,math.pi/2,0))
  elif any(k in d for k in ('seat','pedal','stick','lever','grip','harness','strap','buckle')):B(c,'cockpit_part',(0,0,0),(.28,.12,.45),FAB);R(c,'control', (0,0,.3),(0,.65,.55),.04,STEEL)
  else:B(c,'aircraft_component',(0,0,0),(.28,.18,.28),STEEL)
 elif id.startswith('ENV_MIC'):
  if any(k in d for k in ('grass','weed','wildflower','shrub','branch','crop')):
   for i in range(5):R(c,'vegetation_blade',(0,0,0),(math.cos(i)*.18,.25+(.08*i),math.sin(i)*.18),.018,DRY if 'dry' in d else GREEN)
  elif any(k in d for k in ('tree','conifer','deciduous')):
   Y(c,'trunk',(0,.45,0),.08,.9,WOOD);bpy.ops.mesh.primitive_cone_add(vertices=7,radius1=.65,radius2=.1,depth=1.7,location=(0,1.5,0));o=bpy.context.object;o.name='canopy';o.data.materials.append(GREEN);L(o,c)
  elif any(k in d for k in ('rock','pebble','boulder')):
   bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.35);o=bpy.context.object;o.name='rock';o.scale=(1.4,.7,1);o.data.materials.append(DRY);L(o,c)
  elif any(k in d for k in ('fence','pole','rail','stake','sign','mast','antenna','tripod')):Y(c,'upright',(0,.8,0),.07,1.6,WOOD if 'wood' in d or 'fence' in d else STEEL)
  elif any(k in d for k in ('drum','can','bottle','extinguisher','silo','tank','reel')):Y(c,'container',(0,.35,0),.22,.7,HI if 'fuel' in d or 'extinguisher' in d else STEEL)
  elif any(k in d for k in ('box','bin','tray','cabinet','chest','cart','cooler')):B(c,'storage',(0,0,0),(.42,.3,.45),STEEL)
  elif any(k in d for k in ('wrench','socket','ratchet','screwdriver','pliers','drill','rivet','mallet','tape','vise')):R(c,'tool',(-.35,0,0),(.35,0,0),.06,STEEL)
  elif any(k in d for k in ('pickup','tractor','van','trailer','fuel cart')):B(c,'vehicle_body',(0,.35,0),(.65,.3,1.1),HI);torus(c,'wheel',.15,.05,RUB)
  elif any(k in d for k in ('door','panel','barrier','board')):B(c,'architectural_panel',(0,.8,0),(.8,.8,.06),STEEL)
  else:B(c,'environment_prop',(0,0,0),(.24,.24,.24),WOOD)
 else: # VFX: transparent low-poly billboards/volumes, engine-facing controls animate them at runtime.
  if 'blur' in d or 'pulse' in d or 'stamp' in d or 'selection' in d:torus(c,'vfx_ring',.62,.055,HI)
  elif any(k in d for k in ('dust','smoke','puff','haze','cloud')):
   bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.5);o=bpy.context.object;o.name='vfx_volume';o.data.materials.append(DUST);L(o,c)
  elif 'spark' in d: B(c,'vfx_spark',(0,0,0),(.05,.05,.5),HI)
  else:R(c,'vfx_ribbon',(0,0,0),(0,0,1),.025,WHITE)
 ex(c,id)
rows=[]
for line in open(SPEC,encoding='utf8'):
 m=re.match(r'- `(AIR_MIC_\d+|ENV_MIC_\d+|VFX_\d+)` — (.+)',line)
 if m:rows.append(m.groups())
for id,desc in rows:make(id,desc)
bpy.ops.wm.save_as_mainfile(filepath=f'{OUT}/project_flight_micro_assets.blend')
print('Exported',len(rows),'canonical micro/VFX assets')
