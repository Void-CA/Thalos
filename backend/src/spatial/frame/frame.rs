#[derive(Clone)]
pub enum FrameId {
    World,
    Id(u64),
}

pub struct Frame {
    id: FrameId,
    name: String,
}

impl Frame {
    pub fn new(id: FrameId, name: String) -> Self {
        Self { id, name }
    }

    pub fn world() -> Self {
        Self {
            id: FrameId::World,
            name: "world".into(),
        }
    }

    pub fn id(&self) -> &FrameId {
        &self.id
    }
}