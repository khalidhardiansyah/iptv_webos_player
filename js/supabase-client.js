// Supabase Client Wrapper
class SupabaseClient {
  constructor() {
    if (!window.SUPABASE_CONFIG) {
      console.error('Supabase config not found!');
      return;
    }
    
    this.supabaseUrl = window.SUPABASE_CONFIG.url;
    this.supabaseKey = window.SUPABASE_CONFIG.anonKey;
    this.initialized = false;
    
    // Load Supabase library
    this.loadSupabaseLibrary();
  }
  
  loadSupabaseLibrary() {
    // Check if already loaded
    if (window.supabase) {
      this.initClient();
      return;
    }
    
    // Load from CDN
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.onload = () => {
      console.log('Supabase library loaded');
      this.initClient();
    };
    script.onerror = () => {
      console.error('Failed to load Supabase library');
    };
    document.head.appendChild(script);
  }
  
  initClient() {
    if (!window.supabase || !window.supabase.createClient) {
      console.error('Supabase library not available');
      return;
    }
    
    this.client = window.supabase.createClient(this.supabaseUrl, this.supabaseKey);
    this.initialized = true;
    console.log('Supabase client initialized');
  }
  
  async waitForInit() {
    // Wait for client to be initialized
    let attempts = 0;
    while (!this.initialized && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    if (!this.initialized) {
      throw new Error('Supabase client initialization timeout');
    }
  }
  
  async getPortals() {
    try {
      await this.waitForInit();
      
      const { data, error } = await this.client
        .from('portals')
        .select('*')
        .order('last_used', { ascending: false, nullsFirst: false });
      
      if (error) {
        console.error('Error fetching portals:', error);
        return [];
      }
      
      console.log('Fetched portals:', data);
      return data || [];
    } catch (error) {
      console.error('Get portals error:', error);
      return [];
    }
  }
  
  async updateLastUsed(portalId) {
    try {
      await this.waitForInit();
      
      const timestamp = Date.now();
      const { error } = await this.client
        .from('portals')
        .update({ last_used: timestamp })
        .eq('id', portalId);
      
      if (error) {
        console.error('Error updating last_used:', error);
        return false;
      }
      
      console.log('Updated last_used for portal:', portalId);
      return true;
    } catch (error) {
      console.error('Update last_used error:', error);
      return false;
    }
  }
  
  async getPortal(portalId) {
    try {
      await this.waitForInit();
      
      const { data, error } = await this.client
        .from('portals')
        .select('*')
        .eq('id', portalId)
        .single();
      
      if (error) {
        console.error('Error fetching portal:', error);
        return null;
      }
      
      return data;
    } catch (error) {
      console.error('Get portal error:', error);
      return null;
    }
  }
}

window.SupabaseClient = SupabaseClient;
