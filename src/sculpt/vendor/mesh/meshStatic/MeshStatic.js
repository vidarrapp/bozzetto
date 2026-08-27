import Mesh from '@sculpt-vendor/mesh/Mesh';
import TransformData from '@sculpt-vendor/mesh/TransformData';
import MeshData from '@sculpt-vendor/mesh/MeshData';
// BOZZETTO EDIT: RenderData is not vendored; meshes run render-less.

class MeshStatic extends Mesh {

  constructor(gl) {
    super();

    this._id = Mesh.ID++; // useful id to retrieve a mesh (dynamic mesh, multires mesh, voxel mesh)

    this._meshData = new MeshData();
    this._transformData = new TransformData();
  }
}

export default MeshStatic;
